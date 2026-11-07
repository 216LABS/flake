import { onboardTenant } from '@flake/contracts';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { HttpError, parseJson, route } from '@/lib/http';
import { createTenantForUser } from '@/lib/tenants';

export const POST = route(async (req) => {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Sign in first');
  const body = await parseJson(req, onboardTenant);
  return NextResponse.json({ tenant_id: await createTenantForUser(user.id, user.email, body.name, body.timezone) }, { status: 201 });
});
