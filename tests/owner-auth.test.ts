import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyOwnerPassword } from '../functions/_lib/owner-auth.ts';
import { base64url } from '../functions/_lib/security.ts';

const PBKDF2_ITERATIONS = 100_000;

async function passwordHash(password: string): Promise<string> {
  const salt = new Uint8Array(16).fill(7);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, material, 256);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(new Uint8Array(bits))}`;
}

function structuredHash(iterations: number, saltBytes = 16, derivedBytes = 32): string {
  return `pbkdf2-sha256$${iterations}$${base64url(new Uint8Array(saltBytes).fill(7))}$${base64url(new Uint8Array(derivedBytes).fill(9))}`;
}

test('accepts the correct password with exactly 100000 iterations', async () => {
  assert.equal(await verifyOwnerPassword('correct horse battery staple', await passwordHash('correct horse battery staple')), true);
});

test('rejects an incorrect password with exactly 100000 iterations', async () => {
  assert.equal(await verifyOwnerPassword('wrong password', await passwordHash('correct horse battery staple')), false);
});

test('rejects 600000 iterations before calling deriveBits', async () => {
  const subtle = crypto.subtle;
  let deriveBitsCalls = 0;
  Object.defineProperty(subtle, 'deriveBits', {
    configurable: true,
    value() {
      deriveBitsCalls += 1;
      throw new Error('deriveBits must not be called');
    },
  });
  try {
    assert.equal(await verifyOwnerPassword('password', structuredHash(600_000)), false);
    assert.equal(deriveBitsCalls, 0);
  } finally {
    Reflect.deleteProperty(subtle, 'deriveBits');
  }
});

test('rejects a malformed hash', async () => {
  assert.equal(await verifyOwnerPassword('password', 'not-a-password-hash'), false);
});

test('rejects a salt shorter than 16 bytes', async () => {
  assert.equal(await verifyOwnerPassword('password', structuredHash(PBKDF2_ITERATIONS, 15, 32)), false);
});

test('rejects a derived hash that is not 32 bytes', async () => {
  assert.equal(await verifyOwnerPassword('password', structuredHash(PBKDF2_ITERATIONS, 16, 31)), false);
});
