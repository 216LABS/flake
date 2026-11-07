import type { PushMessage, PushProvider, PushTarget } from '../types';

/** Standard Web Push with VAPID keys. The browser vendors' push services are free, so there is no account to pay for. */
export class LivePush implements PushProvider {
  constructor(public publicKey: string, private privateKey: string, private subject: string) {}

  async send(target: PushTarget, message: PushMessage) {
    const webpush = (await import('web-push')).default;
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        { vapidDetails: { subject: this.subject, publicKey: this.publicKey, privateKey: this.privateKey }, TTL: 3600, urgency: 'high' },
      );
      return { status: 'sent' as const };
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      // The person turned alerts off or the browser dropped the subscription. Retrying can never work.
      if (code === 404 || code === 410) return { status: 'gone' as const };
      throw new Error(`Push failed with status ${code ?? 'unknown'}`, { cause: err });
    }
  }
}

export class MockPush implements PushProvider {
  publicKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
  async send(target: PushTarget) {
    return { status: target.endpoint.includes('gone') ? ('gone' as const) : ('sent' as const) };
  }
}

/** No keys set. Alerts still go by email, and Settings says push is off. */
export const noPush = (): PushProvider => ({
  publicKey: null,
  send: async () => {
    throw new Error('Push is not configured');
  },
});
