'use client';

import { Button, Card } from '@flake/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

function keyBytes(base64url: string) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

type State = 'checking' | 'unsupported' | 'needs_install' | 'blocked' | 'off' | 'on';

export function PushPanel({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>('checking');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!supported) {
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
        return setState(ios ? 'needs_install' : 'unsupported');
      }
      if (Notification.permission === 'denied') return setState('blocked');
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })().catch(() => setState('off'));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enable = () => run(async () => {
    if ((await Notification.requestPermission()) !== 'granted') {
      setState('blocked');
      return;
    }
    const reg = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) });
    await api('/api/push/subscribe', { body: sub.toJSON() });
    setState('on');
    setMsg('Alerts are on for this device.');
  });

  const disable = () => run(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    setState('off');
    setMsg('Alerts are off for this device.');
  });

  return (
    <Card className="max-w-xl" data-testid="push-panel" data-state={publicKey ? state : 'not_configured'}>
      <h2 className="font-semibold">Alerts on this device</h2>
      <p className="mt-1 text-sm text-muted">Trigger alerts, late sites and driver problems as notifications, for owners and dispatchers. Email alerts keep working either way.</p>
      {!publicKey ? <p className="mt-3 text-sm text-ink-2">Push is not set up on this deployment yet, so alerts go by email.</p> : null}
      {publicKey && state === 'unsupported' ? <p className="mt-3 text-sm text-ink-2">This browser can&apos;t receive push notifications.</p> : null}
      {publicKey && state === 'needs_install' ? <p className="mt-3 text-sm text-ink-2">On iPhone, tap Share, then Add to Home Screen, and open Flake from there. iOS only allows notifications for installed apps (iOS 16.4 or newer).</p> : null}
      {publicKey && state === 'blocked' ? <p className="mt-3 text-sm text-ink-2">Notifications are blocked for this site. Allow them in your browser settings, then come back.</p> : null}
      {publicKey && state === 'off' ? <Button className="mt-3" variant="accent" disabled={busy} data-testid="push-enable" onClick={enable}>Turn on alerts</Button> : null}
      {publicKey && state === 'on' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} data-testid="push-test" onClick={() => run(async () => { await api('/api/push/test', { method: 'POST' }); setMsg('Test alert sent. It can take a couple of minutes.'); })}>Send a test alert</Button>
          <Button variant="ghost" disabled={busy} data-testid="push-disable" onClick={disable}>Turn off</Button>
        </div>
      ) : null}
      {msg ? <p className="mt-2 text-sm text-muted" data-testid="push-msg">{msg}</p> : null}
    </Card>
  );
}
