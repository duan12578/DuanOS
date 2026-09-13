import { clearCookie, json, sameOrigin, sessionFor } from '../../_lib/security.ts';
import type { PagesHandler } from '../../_lib/types.ts';

export const onRequestPost: PagesHandler = async ({ request, env }) => {
  if (!sameOrigin(request)) return json({ ok: false, error: 'ORIGIN_REJECTED' }, 403);
  const session = await sessionFor(request, env);
  if (session) await env.DUANOS_KV.delete(`session:${session.id}`);
  const response = json({ ok: true });
  response.headers.set('Set-Cookie', clearCookie('__Host-duanos_session'));
  return response;
};
