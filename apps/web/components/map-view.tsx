'use client';

import { geodesicSqft } from '@flake/core/area';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';

export interface TileLayers { streets: { tiles: string[]; attribution: string; maxzoom?: number }; satellite: { tiles: string[]; attribution: string; maxzoom?: number } }
export interface MapPin {
  id: string; lat: number; lon: number; color?: string; label?: string;
  /** A number on the pin: the stop's place in its truck's order (issue 191). */
  n?: number;
  /** An outline in the truck's color. */
  ring?: string;
}
/** A line through points in order: a planned route. */
export interface MapLine { id: string; color: string; coords: { lat: number; lon: number }[]; dashed?: boolean }
export interface LegendItem { color: string; label: string; ring?: boolean }
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
  /** The pin to enlarge and fly to. */
  selected?: string | null;
  onPinClick?: (id: string) => void;
  lines?: MapLine[];
  /** Zoom to show every pin and line once they're drawn. */
  fit?: boolean;
  /** What the colors mean, on the map itself (issue 191). */
  legend?: LegendItem[];
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
export function MapView({ layers, base = 'streets', center, zoom = 17, pins = [], polygon, mode = 'view', onPolygon, onWalk, onPin, className, selected = null, onPinClick, lines = [], fit = false, legend }: Props) {
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
  const cb = useRef({ onPolygon, onWalk, onPin, onPinClick });
  cb.current = { onPolygon, onWalk, onPin, onPinClick };
  const fitted = useRef(false);

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
          m.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          m.addLayer({ id: 'routes-line', type: 'line', source: 'routes', paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85 } });
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
      const big = p.id === selected;
      let marker: Marker;
      if (p.n !== undefined || p.ring) {
        // A round pin with its number, ringed in its truck's color.
        const el = document.createElement('button');
        el.type = 'button';
        el.dataset.pin = p.id;
        el.setAttribute('aria-label', p.label ?? `Stop ${p.n ?? ''}`);
        const size = big ? 34 : 24;
        el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;background:${p.color ?? '#475569'};color:#fff;font:700 ${big ? 14 : 11}px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;border:3px solid ${p.ring ?? '#fff'};box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:pointer;${big ? 'z-index:5;' : ''}`;
        el.textContent = p.n !== undefined ? String(p.n) : '';
        marker = new L.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(m);
      } else {
        marker = new L.Marker({ color: p.color ?? '#475569', scale: big ? 1.3 : 1 }).setLngLat([p.lon, p.lat]).addTo(m);
        marker.getElement().dataset.pin = p.id;
      }
      if (p.label) marker.setPopup(new L.Popup({ offset: 24 }).setText(p.label));
      marker.getElement().addEventListener('click', () => cb.current.onPinClick?.(p.id));
      return marker;
    });
    if (fit && !fitted.current && (pins.length || lines.length)) {
      const pts = [...pins.map((p) => [p.lon, p.lat] as [number, number]), ...lines.flatMap((l) => l.coords.map((c) => [c.lon, c.lat] as [number, number]))];
      if (pts.length > 1) {
        const b = pts.reduce((acc, [x, y]) => [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
        m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 15, duration: 0 });
        fitted.current = true;
      }
    }
  }, [pins, ready, selected]);

  useEffect(() => {
    const m = map.current;
    if (!m?.isStyleLoaded()) return;
    (m.getSource('routes') as any)?.setData({ type: 'FeatureCollection', features: lines.map((l) => ({ type: 'Feature', properties: { color: l.color }, geometry: { type: 'LineString', coordinates: l.coords.map((c) => [c.lon, c.lat]) } })) });
  }, [lines, ready]);

  useEffect(() => {
    const p = pins.find((x) => x.id === selected);
    if (p) map.current?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.current.getZoom(), 14) });
  }, [selected]);

  if (failed) return <div className={`flex items-center justify-center rounded-md border bg-tint-2 p-6 text-sm text-muted ${className ?? 'h-72'}`}>The map could not load on this device. You can still type the area.</div>;
  return (
    <div className={`relative ${className ?? 'h-72'}`}>
      <div ref={box} data-testid="map" className="h-full rounded-md border" />
      {legend?.length ? (
        // Open on a desk, one tap away on a phone (issue 191).
        <details className="group absolute left-2 top-2 z-10 max-w-[70%] rounded-md bg-white/95 p-2 text-xs text-slate-900 shadow-popup" open={typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches} data-testid="map-legend">
          <summary className="cursor-pointer font-semibold">Key</summary>
          <ul className="mt-1 space-y-1">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block size-3 shrink-0 rounded-full" style={l.ring ? { border: `3px solid ${l.color}`, background: '#fff' } : { background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
