import { toolContract } from '@flake/contracts';
import { lead, serviceDb } from '@flake/db';
import { clientIp, parseJson, rateLimit, route } from '@/lib/http';

/** Public, no account. The email is optional and only then becomes a lead. */
export const POST = route(async (req) => {
  rateLimit(`tool:${clientIp(req)}`, 20, 60000);
  const b = await parseJson(req, toolContract);
  if (b.email) await serviceDb().insert(lead).values({ source: 'tool_contract', email: b.email, business: b.company, payload: { pricing_type: b.pricing_type } });
  const { renderContractPdf } = await import('@flake/providers/pdf');
  const pdf = await renderContractPdf({
    company: b.company,
    customer: b.client,
    site: b.site,
    season: `${b.season_start} to ${b.season_end}`,
    services: [],
    serviceLines: [`Services: ${b.services.join(', ')}`, b.trigger_in === 0 ? 'Trigger: zero tolerance, any measurable snow' : `Trigger depth: ${b.trigger_in}"`, `Pricing (${b.pricing_type.replace(/_/g, ' ')}): ${b.price_text}`],
    saltText: b.salt_text ? `Salt: ${b.salt_text}` : null,
    terms: [b.insurance_text && `Liability and insurance: ${b.insurance_text}`, `Payment terms: ${b.payment_terms}`].filter(Boolean).join('\n\n'),
    disclaimer: 'This template is not legal advice. Have an attorney review it for your state before you rely on it.',
    footerCta: 'Run this contract in Flake free: flake.216labs.dev',
  });
  return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="snow-removal-contract.pdf"' } });
});
