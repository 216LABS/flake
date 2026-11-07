import { mockConfirm } from '@flake/contracts';
import { parseJson, route } from '@/lib/http';
import { mockConfirmSetup } from '@/lib/quotes';

/** Answers only when the payments provider is the mock. */
export const POST = route<{ params: Promise<{ token: string }> }>(async (req, { params }) => mockConfirmSetup((await params).token, await parseJson(req, mockConfirm)));
