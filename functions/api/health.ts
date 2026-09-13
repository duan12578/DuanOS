import { json, sessionFor } from '../_lib/security.ts';
import type { PagesHandler } from '../_lib/types.ts';

export const onRequestGet: PagesHandler = async ({ request, env }) => {
  const session = await sessionFor(request, env);
  return json({ ok: true, authenticated: Boolean(session), email: session?.value.email ?? null });
};
