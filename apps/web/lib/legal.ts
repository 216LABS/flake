/**
 * When each policy last changed (issue 172). The pages show these dates, and a new company stores them with its owner's
 * agreement, so a later change can be told apart from what they agreed to.
 */
export const TERMS_UPDATED = '2026-11-19';
export const PRIVACY_UPDATED = '2026-11-10';
export const TERMS_VERSION = `terms ${TERMS_UPDATED}; privacy ${PRIVACY_UPDATED}`;

export const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
