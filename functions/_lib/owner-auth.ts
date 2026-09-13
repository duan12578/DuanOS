import { base64url, fromBase64url, utf8 } from './security.ts';

const HASH_PATTERN = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;
const MIN_ITERATIONS = 600_000;
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0; for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
export async function verifyOwnerPassword(password: string, encoded: string): Promise<boolean> {
  const match = HASH_PATTERN.exec(encoded.trim()); if (!match || !password || Number(match[1]) < MIN_ITERATIONS) return false;
  try {
    const salt = fromBase64url(match[2]); const expected = fromBase64url(match[3]);
    if (salt.length < 16 || expected.length !== 32) return false;
    const material = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: Number(match[1]) }, material, 256);
    return equalBytes(new Uint8Array(bits), expected);
  } catch { return false; }
}
export async function rateLimitKey(request: Request): Promise<string> {
  const identity = `${request.headers.get('CF-Connecting-IP') ?? 'unknown'}|${request.headers.get('User-Agent') ?? 'unknown'}`;
  const digest = await crypto.subtle.digest('SHA-256', utf8.encode(identity));
  return `login-fail:${base64url(new Uint8Array(digest))}`;
}
export type LoginFailures = { count: number; windowStartedAt: number; lockedUntil?: number };
export const loginWindowMs = 15 * 60_000;
export const maxLoginFailures = 5;
