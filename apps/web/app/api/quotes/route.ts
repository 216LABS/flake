import { quoteCreate } from '@flake/contracts';
import { NextResponse } from 'next/server';
import { requireApi } from '@/lib/auth';
import { parseJson, route } from '@/lib/http';
import { createQuote } from '@/lib/quotes';

export const POST = route(async (req) => {
  const ctx = await requireApi('dispatcher');
  const { contract, url } = await createQuote(ctx, await parseJson(req, quoteCreate));
  return NextResponse.json({ contract_id: contract.id, url }, { status: 201 });
});
