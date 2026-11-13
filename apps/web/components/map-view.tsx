'use client';

import { geodesicSqft } from '@flake/core/area';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';

export interface TileLayers { streets: { tiles: string[]; attribution: string; maxzoom?: number }; satellite: { tiles: string[]; attribution: string; maxzoom?: number } }
export interface MapPin { id: string; lat: number; lon: number; color?: string; label?: string }
export type MapMode = 'view' | 'edit' | 'walk' | 'pin';

interface Props {
  layers: TileLayers;
  base?: 'streets' | 'satellite';
  center: { lat: number; lon: number };
  zoom?: number;
  pins?: MapPin[];
  polygon?: Polygon | MultiPolygon | null;
  mode?: MapMode;
  onPolygon?: (p: Polygon | null, sqft: number | null) => void;
  onWalk?: (feet: number) => void;
  onPin?: (lat: number, lon: number) => void;
  className?: string;
}

const firstRing = (g: Polygon | MultiPolygon | null | undefined): Position[] => {
  if (!g) return [];
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0];
  return ring ? ring.slice(0, -1) : [];
};

const feetBetween = (a: Position, b: Position) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b[1]! - a[1]!) * rad) / 2) ** 2 + Math.cos(a[1]! * rad) * Math.cos(b[1]! * rad) * Math.sin(((b[0]! - a[0]!) * rad) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h)) * 3.28084;
};

/** MapLibre with hand-rolled vertex editing. If WebGL is missing it says so; every map task has a typed fallback. */
export function MapView({ layers, base = 'streets', center, zoom = 17, pins = [], polygon, mode = 'view', onPolygon, onWalk, onPin, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const lib = useRef<typeof import('maplibre-gl') | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const verts = useRef<Position[]>(firstRing(polygon));
  const walk = useRef<Position[]>([]);
  const vertexMarkers = useRef<Marker[]>([]);
  const pinMarkers = useRef<Marker[]>([]);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const cb = useRef({ onPolygon, onWalk, onPin });
  cb.current = { onPolygon, onWalk, onPin };

  const paint = () => {
    const m = map.current;
    if (!m?.isStyleLoaded()) return;
    const v = verts.current;
    const ring = v.length >= 3 ? [...v, v[0]!] : [];
    (m.getSource('poly') as any)?.setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: ring.length ? [ring] : [] } });
    (m.getSource('walk') as any)?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: walk.current } });
  };

  const emit = () => {
    const v = verts.current;
    if (v.length < 3) return cb.current.onPolygon?.(null, null);
    const poly: Polygon = { type: 'Polygon', coordinates: [[...v, v[0]!]] };
    cb.current.onPolygon?.(poly, Math.round(geodesicSqft(poly)));
  };

  const syncHandles = () => {
    const m = map.current;
    const L = lib.current;
    vertexMarkers.current.forEach((x) => x.remove());
    vertexMarkers.current = [];
    if (!m || !L || modeRef.current !== 'edit') return;
    verts.current.forEach((pos, i) => {
      const marker = new L.Marker({ draggable: true, color: '#0369a1', scale: 0.6 }).setLngLat(pos as [number, number]).addTo(m);
      marker.on('drag', () => {
        const ll = marker.getLngLat();
        verts.current[i] = [ll.lng, ll.lat];
        paint();
      });
      marker.on('dragend', emit);
      vertexMarkers.current.push(marker);
    });
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const L = await import('maplibre-gl');
        L.setWorkerUrl('/maplibre-gl-worker.mjs');
        if (dead || !box.current) return;
        lib.current = L;
        const layer = layers[base];
        const m = new L.Map({
          container: box.current,
          center: [center.lon, center.lat],
          zoom,
          style: {
            version: 8,
            sources: { base: { type: 'raster', tiles: layer.tiles, tileSize: 256, attribution: layer.attribution, ...(layer.maxzoom ? { maxzoom: layer.maxzoom } : {}) } },
            layers: [{ id: 'base', type: 'raster', source: 'base' }],
          },
        });
        map.current = m;
        m.on('error', () => {});
        m.on('load', () => {
          m.addSource('poly', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } } });
          m.addLayer({ id: 'poly-fill', type: 'fill', source: 'poly', paint: { 'fill-color': '#0284c7', 'fill-opacity': 0.3 } });
          m.addLayer({ id: 'poly-line', type: 'line', source: 'poly', paint: { 'line-color': '#0369a1', 'line-width': 2 } });
          m.addSource('walk', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
          m.addLayer({ id: 'walk-line', type: 'line', source: 'walk', paint: { 'line-color': '#b45309', 'line-width': 3, 'line-dasharray': [2, 1] } });
          setReady(true);
          paint();
          syncHandles();
        });
        m.on('click', (e) => {
          const pos: Position = [e.lngLat.lng, e.lngLat.lat];
          if (modeRef.current === 'edit') {
            verts.current = [...verts.current, pos];
            paint();
            syncHandles();
            emit();
          } else if (modeRef.current === 'walk') {
            walk.current = [...walk.current, pos];
            paint();
            let total = 0;
            for (let i = 1; i < walk.current.length; i++) total += feetBetween(walk.current[i - 1]!, walk.current[i]!);
            cb.current.onWalk?.(Math.round(total));
          } else if (modeRef.current === 'pin') {
            cb.current.onPin?.(pos[1]!, pos[0]!);
          }
        });
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    map.current?.jumpTo({ center: [center.lon, center.lat] });
  }, [center.lat, center.lon]);

  useEffect(() => {
    verts.current = firstRing(polygon);
    paint();
    syncHandles();
  }, [polygon, ready]);

  useEffect(() => {
    syncHandles();
    if (mode === 'walk') {
      walk.current = [];
      paint();
    }
  }, [mode]);

  useEffect(() => {
    const m = map.current;
    const L = lib.current;
    if (!m || !L) return;
    pinMarkers.current.forEach((x) => x.remove());
    pinMarkers.current = pins.map((p) => {
      const marker = new L.Marker({ color: p.color ?? '#475569' }).setLngLat([p.lon, p.lat]).addTo(m);
      if (p.label) marker.setPopup(new L.Popup({ offset: 24 }).setText(p.label));
      return marker;
    });
  }, [pins, ready]);

  if (failed) return <div className={`flex items-center justify-center rounded-md border bg-tint-2 p-6 text-sm text-muted ${className ?? 'h-72'}`}>The map could not load on this device. You can still type the area.</div>;
  return <div ref={box} data-testid="map" className={`rounded-md border ${className ?? 'h-72'}`} />;
}
