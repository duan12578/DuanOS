import { encryptJson, secureCookie } from '../../_lib/security.ts';
import { loginUrl, newOAuthState } from '../../_lib/oauth.ts';
import type { PagesHandler } from '../../_lib/types.ts';

export const onRequestGet: PagesHandler = async ({ env }) => {
  const state = newOAuthState();
  return new Response(null, { status: 302, headers: { Location: await loginUrl(env.GOOGLE_CLIENT_ID, env.GOOGLE_REDIRECT_URI, state), 'Set-Cookie': secureCookie('__Host-duanos_oauth', await encryptJson(state, env.SESSION_ENCRYPTION_KEY), 600), 'Cache-Control': 'no-store' } });
};
