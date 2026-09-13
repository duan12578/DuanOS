import type { Env, StoredSession } from './types.ts';

const SESSION_SECONDS = 30 * 24 * 3600;
export const utf8 = new TextEncoder();

export function randomToken(bytes = 32): string { return base64url(crypto.getRandomValues(new Uint8Array(bytes))); }
export function base64url(value: Uint8Array): string {
  let binary = ''; value.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
export function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('Cookie') ?? '';
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
export function secureCookie(name: string, value: string, maxAge = SESSION_SECONDS): string { return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`; }
export function clearCookie(name: string): string { return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`; }
export function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export function sameOrigin(request: Request): boolean { return request.headers.get('Origin') === new URL(request.url).origin; }
export async function sessionFor(request: Request, env: Env): Promise<{ id: string; value: StoredSession } | null> {
  const id = cookieValue(request, '__Host-duanos_session');
  if (!id || !/^[A-Za-z0-9_-]{40,}$/.test(id)) return null;
  const stored = await env.DUANOS_KV.get(`session:${id}`); if (!stored) return null;
  try {
    const value = JSON.parse(stored) as StoredSession;
    if (!Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) { await env.DUANOS_KV.delete(`session:${id}`); return null; }
    return { id, value };
  } catch { return null; }
}
export const sessionSeconds = SESSION_SECONDS;
