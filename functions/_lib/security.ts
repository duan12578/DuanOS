import type { Env, StoredSession } from './types.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(value);
}

export function base64url(value: Uint8Array): string {
  let binary = '';
  value.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptJson(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(JSON.stringify(value)));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

export async function decryptJson<T>(value: string, secret: string): Promise<T> {
  const [iv, encrypted] = value.split('.');
  if (!iv || !encrypted) throw new Error('invalid encrypted value');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(iv) as BufferSource }, await encryptionKey(secret), fromBase64url(encrypted) as BufferSource);
  return JSON.parse(decoder.decode(plain)) as T;
}

export function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('Cookie') ?? '';
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function secureCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function sessionFor(request: Request, env: Env): Promise<{ id: string; value: StoredSession } | null> {
  const id = cookieValue(request, '__Host-duanos_session');
  if (!id || !/^[A-Za-z0-9_-]{40,}$/.test(id)) return null;
  const encrypted = await env.DUANOS_KV.get(`session:${id}`);
  if (!encrypted) return null;
  try { return { id, value: await decryptJson<StoredSession>(encrypted, env.SESSION_ENCRYPTION_KEY) }; }
  catch { return null; }
}
