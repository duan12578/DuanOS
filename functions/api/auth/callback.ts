import { clearCookie, cookieValue, decryptJson, encryptJson, randomToken, secureCookie } from '../../_lib/security.ts';
import { validOAuthState, type OAuthState } from '../../_lib/oauth.ts';
import { exchangeCode, userEmail } from '../../_lib/google.ts';
import type { PagesHandler, StoredSession } from '../../_lib/types.ts';

function redirect(location: string, cookies: string[] = []): Response { const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' }); cookies.forEach(cookie => headers.append('Set-Cookie', cookie)); return new Response(null, { status: 302, headers }); }
function errorRedirect(origin: string, code: string): Response { return redirect(`${origin}/?auth_error=${encodeURIComponent(code)}`); }

export const onRequestGet: PagesHandler = async ({ request, env }) => {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get('code');
  const receivedState = url.searchParams.get('state');
  const stateCookie = cookieValue(request, '__Host-duanos_oauth');
  if (!code || !receivedState || !stateCookie) return errorRedirect(origin, 'invalid_oauth_response');
  let stored: OAuthState;
  try { stored = await decryptJson<OAuthState>(stateCookie, env.SESSION_ENCRYPTION_KEY); }
  catch { return errorRedirect(origin, 'invalid_oauth_state'); }
  if (!validOAuthState(stored, receivedState)) return errorRedirect(origin, 'invalid_oauth_state');
  try {
    const tokens = await exchangeCode(env, code, stored.verifier);
    const email = await userEmail(tokens.access_token);
    if (email !== env.ALLOWED_GOOGLE_EMAIL.trim().toLowerCase()) return errorRedirect(origin, 'owner_only');
    const id = randomToken(32);
    const session: StoredSession = { email, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
    await env.DUANOS_KV.put(`session:${id}`, await encryptJson(session, env.SESSION_ENCRYPTION_KEY), { expirationTtl: 30 * 24 * 3600 });
    return redirect(`${origin}/`, [secureCookie('__Host-duanos_session', id, 30 * 24 * 3600), clearCookie('__Host-duanos_oauth')]);
  } catch { return errorRedirect(origin, 'google_oauth_failed'); }
};
