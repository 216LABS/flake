import { quoteCreate } from '@flake/contracts';
import { NextResponse } from 'next/server';
import { requireApi } from '@/lib/auth';
import { emailConfigured } from '@/lib/env';
import { parseJson, route } from '@/lib/http';
import { createQuote } from '@/lib/quotes';

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { contract, url, lots } = await createQuote(ctx, await parseJson(req, quoteCreate));
  return NextResponse.json({ contract_id: contract.id, url, lots, emailed: emailConfigured() }, { status: 201 });
});
