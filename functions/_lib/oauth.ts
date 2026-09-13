import { base64url, randomToken } from './security.ts';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
];

export interface OAuthState { state: string; verifier: string; createdAt: number }

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export async function loginUrl(clientId: string, redirectUri: string, state: OAuthState): Promise<string> {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state: state.state, code_challenge: await pkceChallenge(state.verifier), code_challenge_method: 'S256' }).toString();
  return url.toString();
}

export function newOAuthState(now = Date.now()): OAuthState { return { state: randomToken(), verifier: randomToken(48), createdAt: now }; }
export function validOAuthState(stored: OAuthState, received: string, now = Date.now()): boolean {
  return stored.state === received && now - stored.createdAt >= 0 && now - stored.createdAt <= 10 * 60_000;
}
