import { loginWindowMs, maxLoginFailures, rateLimitKey, type LoginFailures, verifyOwnerPassword } from '../../_lib/owner-auth.ts';
import { json, randomToken, sameOrigin, secureCookie, sessionFor, sessionSeconds } from '../../_lib/security.ts';
import type { PagesHandler, StoredSession } from '../../_lib/types.ts';

export const onRequestPost: PagesHandler = async ({ request, env }) => {
  if (!sameOrigin(request)) return json({ ok: false, error: 'ORIGIN_REJECTED' }, 403);
  const key = await rateLimitKey(request); const now = Date.now(); let failures: LoginFailures | null = null;
  try { failures = JSON.parse(await env.DUANOS_KV.get(key) ?? 'null') as LoginFailures | null; } catch { failures = null; }
  if (failures?.lockedUntil && failures.lockedUntil > now) return json({ ok: false, error: 'LOGIN_TEMPORARILY_LOCKED' }, 429);
  let password = '';
  try { const body = await request.json() as { password?: unknown }; if (typeof body.password === 'string' && body.password.length <= 1024) password = body.password; } catch { /* generic failure */ }
  if (!await verifyOwnerPassword(password, env.DUANOS_OWNER_PASSWORD_HASH ?? '')) {
    const active = failures && now - failures.windowStartedAt < loginWindowMs ? failures : { count: 0, windowStartedAt: now };
    active.count += 1; if (active.count >= maxLoginFailures) active.lockedUntil = now + loginWindowMs;
    await env.DUANOS_KV.put(key, JSON.stringify(active), { expirationTtl: Math.ceil(loginWindowMs / 1000) });
    return json({ ok: false, error: active.lockedUntil ? 'LOGIN_TEMPORARILY_LOCKED' : 'INVALID_CREDENTIALS' }, active.lockedUntil ? 429 : 401);
  }
  await env.DUANOS_KV.delete(key);
  const previous = await sessionFor(request, env); if (previous) await env.DUANOS_KV.delete(`session:${previous.id}`);
  const id = randomToken(); const value: StoredSession = { createdAt: now, expiresAt: now + sessionSeconds * 1000 };
  await env.DUANOS_KV.put(`session:${id}`, JSON.stringify(value), { expirationTtl: sessionSeconds });
  const response = json({ ok: true, authenticated: true }); response.headers.set('Set-Cookie', secureCookie('__Host-duanos_session', id)); return response;
};
