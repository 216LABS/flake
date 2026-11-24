'use client';

import { Button, Card, Input, Label } from '@flake/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

type Lang = 'en' | 'es';

/** The join page follows the crew member's language (issue 177): it's the first thing a driver reads. */
const T = {
  en: {
    title: (name: string, company: string) => `${name}, join ${company}`,
    expired: 'This invite has expired.',
    expiredBody: (company: string) => `Join links work for two weeks. Ask ${company} to send you a new one.`,
    already: "You're already on the crew.",
    alreadyBody: (company: string) => `Your route link comes when a storm starts. To change your number, ask ${company} for a new join link.`,
    done: "✓ You're on the crew",
    doneText: (canText: boolean, company: string) => `Your route link comes by text when a storm starts${canText ? '' : `, once ${company} has texting set up. Until then they show you a QR code to scan`}.`,
    doneQr: (company: string) => `${company} will show you a QR code for your route when a storm starts.`,
    nothing: 'There is nothing to install, and you can close this page.',
    intro: "Route links open in your phone's browser with no app and no login. While your route page is open and a storm is active, it uses your location to prompt you when you arrive and to record your arrival. It doesn't track you in the background.",
    mobile: 'Your mobile number',
    hasPhone: (company: string, last4?: string | null) => last4 ? `${company} has your number ending in ${last4}. Leave this empty unless that's wrong.` : `${company} already has a number for you. Enter yours here only if it's different.`,
    noPhone: 'Your route links come to this number by text.',
    badPhone: 'Enter a 10-digit US mobile number.',
    join: 'Join',
  },
  es: {
    title: (name: string, company: string) => `${name}, únete a ${company}`,
    expired: 'Esta invitación ya venció.',
    expiredBody: (company: string) => `Los enlaces para unirte sirven por dos semanas. Pídele a ${company} uno nuevo.`,
    already: 'Ya estás en el equipo.',
    alreadyBody: (company: string) => `Tu enlace de ruta llega cuando empieza una tormenta. Para cambiar tu número, pídele a ${company} un enlace nuevo.`,
    done: '✓ Ya estás en el equipo',
    doneText: (canText: boolean, company: string) => `Tu enlace de ruta llega por texto cuando empieza una tormenta${canText ? '' : `, cuando ${company} tenga los textos listos. Mientras tanto te muestran un código QR para escanear`}.`,
    doneQr: (company: string) => `${company} te mostrará un código QR para tu ruta cuando empiece una tormenta.`,
    nothing: 'No hay nada que instalar y puedes cerrar esta página.',
    intro: 'Los enlaces de ruta se abren en el navegador de tu teléfono, sin app y sin iniciar sesión. Mientras tu página de ruta está abierta y hay una tormenta activa, usa tu ubicación para avisarte cuando llegas y para registrar tu llegada. No te rastrea en segundo plano.',
    mobile: 'Tu número de celular',
    hasPhone: (company: string, last4?: string | null) => last4 ? `${company} tiene tu número que termina en ${last4}. Déjalo vacío salvo que esté mal.` : `${company} ya tiene un número tuyo. Escribe el tuyo aquí solo si es otro.`,
    noPhone: 'Tus enlaces de ruta llegan a este número por texto.',
    badPhone: 'Escribe un número de celular de EE. UU. de 10 dígitos.',
    join: 'Unirme',
  },
} as const;

/**
 * A driver joins the crew: their mobile, and whether they agree to route links by text (D16: drivers get texts, never
 * email). Saying no still joins; the office then shows them the route's QR code.
 */
export function JoinForm({ token, company, name, hasPhone, phoneLast4 = null, consentText, canText, joined = false, expired = false, lang = 'en' }: { expired?: boolean; token: string; company: string; name: string; hasPhone: boolean; phoneLast4?: string | null; consentText: string; email?: string; canText: boolean; joined?: boolean; lang?: Lang }) {
  const t = T[lang];
  const [consent, setConsent] = useState(false);
  const [phone, setPhone] = useState('');
  const digits = phone.replace(/\D/g, '');
  const phoneOk = !phone.trim() || digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
  // A number is needed only to text them; saying no to texts joins without one.
  const needPhone = consent && !hasPhone && !phone.trim();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <main lang={lang} className="mx-auto max-w-md px-4 py-12">
      <Card>
        <h1 className="text-xl font-semibold">{t.title(name, company)}</h1>
        {expired ? (
          <div className="mt-4 rounded-md bg-warn-tint p-4 text-warn-ink" role="status" data-testid="invite-expired">
            <p className="font-semibold">{t.expired}</p>
            <p className="mt-1 text-sm">{t.expiredBody(company)}</p>
          </div>
        ) : joined ? (
          <div className="mt-4 rounded-md bg-tint p-4" role="status" data-testid="already-joined">
            <p className="font-semibold">{t.already}</p>
            <p className="mt-1 text-sm text-ink-2">{t.alreadyBody(company)}</p>
          </div>
        ) : done ? (
          <div className="mt-4 rounded-md bg-ok-tint p-4 text-ok-ink" role="status" data-testid="joined">
            <p className="text-lg font-semibold">{t.done}</p>
            <p className="mt-1 text-sm">{consent ? t.doneText(canText, company) : t.doneQr(company)} {t.nothing}</p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">{t.intro}</p>
            <div className="mt-4">
              <Label htmlFor="join-phone">{t.mobile}</Label>
              <Input id="join-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={hasPhone ? '' : '(216) 555-0101'} value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="join-phone" aria-describedby="join-phone-hint" />
              <p id="join-phone-hint" className="mt-1 text-xs text-muted">{hasPhone ? t.hasPhone(company, phoneLast4) : t.noPhone}</p>
              {!phoneOk ? <p className="mt-1 text-xs text-danger">{t.badPhone}</p> : null}
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="crew-consent" /> {consentText}</label>
            <Button variant="accent" className="mt-4 w-full" disabled={needPhone || !phoneOk} data-testid="join" onClick={async () => { setError(null); try { await api(`/api/join/${token}`, { body: { consent, phone: phone.trim() ? `+1${digits.slice(-10)}` : '' } }); setDone(true); } catch (e) { setError((e as Error).message); } }}>{t.join}</Button>
            {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
          </>
        )}
      </Card>
    </main>
  );
}
