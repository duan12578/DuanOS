import { clearCookie, json, sessionFor } from '../../_lib/security.ts';
import type { PagesHandler } from '../../_lib/types.ts';

export const onRequestPost: PagesHandler = async ({ request, env }) => {
  const session = await sessionFor(request, env);
  if (session) await env.DUANOS_KV.delete(`session:${session.id}`);
  const response = json({ ok: true });
  response.headers.set('Set-Cookie', clearCookie('__Host-duanos_session'));
  return response;
};
