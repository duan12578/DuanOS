import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newOAuthState, validOAuthState, GOOGLE_SCOPES } from '../functions/_lib/oauth.ts';
import { ledgerRow, validateLedgerPayload } from '../functions/_lib/ledger.ts';
import { encryptJson } from '../functions/_lib/security.ts';
import { onRequestPost } from '../functions/api/ledger.ts';
import type { Env, KVNamespaceLike, StoredSession } from '../functions/_lib/types.ts';

class MemoryKV implements KVNamespaceLike {
  data = new Map<string, string>();
  async get(key: string) { return this.data.get(key) ?? null; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
}
const payload = { id: 'stable-id-123', date: '2026-09-13', type: '支出' as const, category: '餐饮', amountCents: 2500, account: '微信零钱', content: '午饭', note: '', counterpartyAccount: '', recordedAt: '2026-09-13T00:00:00.000Z' };

test('OAuth state expires and scopes exclude Calendar', () => {
  const state = newOAuthState(1_000);
  assert.equal(validOAuthState(state, state.state, 2_000), true);
  assert.equal(validOAuthState(state, 'other', 2_000), false);
  assert.equal(validOAuthState(state, state.state, 1_000 + 600_001), false);
  assert.ok(GOOGLE_SCOPES.some(scope => scope.includes('spreadsheets')));
  assert.ok(GOOGLE_SCOPES.some(scope => scope.includes('gmail.send')));
  assert.ok(!GOOGLE_SCOPES.some(scope => scope.includes('calendar')));
});

test('ledger validation and row order match the nine sheet columns', () => {
  assert.deepEqual(ledgerRow(validateLedgerPayload(payload)), ['2026-09-13', '支出', '餐饮', '25.00', '微信零钱', '午饭', '', '', '2026-09-13 08:00:00']);
  assert.throws(() => validateLedgerPayload({ ...payload, amountCents: -1 }));
  assert.throws(() => validateLedgerPayload({ ...payload, type: '退款' }));
});

test('ledger API rejects cross-origin writes before reading credentials', async () => {
  const env: Env = { DUANOS_KV: new MemoryKV(), GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '', ALLOWED_GOOGLE_EMAIL: '', SESSION_ENCRYPTION_KEY: '' };
  const request = new Request('https://example.com/api/ledger', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal((await onRequestPost({ request, env })).status, 403);
});

test('sequential retries are idempotent and never append or email twice', async () => {
  const kv = new MemoryKV();
  const secret = 'test-secret-at-least-thirty-two-characters';
  const session: StoredSession = { email: 'owner@example.com', accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600_000 };
  await kv.put('session:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN', await encryptJson(session, secret));
  const env: Env = { DUANOS_KV: kv, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'https://example.com/api/auth/callback', ALLOWED_GOOGLE_EMAIL: 'owner@example.com', SESSION_ENCRYPTION_KEY: secret };
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes('/drive/v3/files')) return Response.json({ files: [{ id: 'sheet-id', name: '个人记账｜口述版' }] });
    if (url.includes('/v4/spreadsheets/sheet-id?')) return Response.json({ sheets: [{ properties: { title: '记账流水' } }] });
    return Response.json({});
  };
  try {
    const request = () => new Request('https://example.com/api/ledger', { method: 'POST', headers: { Origin: 'https://example.com', Cookie: '__Host-duanos_session=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal((await onRequestPost({ request: request(), env })).status, 200);
    const second = await onRequestPost({ request: request(), env });
    assert.equal((await second.json() as { duplicate: boolean }).duplicate, true);
    assert.equal(calls.filter(url => url.includes(':append')).length, 1);
    assert.equal(calls.filter(url => url.includes('/messages/send')).length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('a Gmail failure retries only the receipt after the sheet row is confirmed', async () => {
  const kv = new MemoryKV();
  const secret = 'another-test-secret-at-least-thirty-two';
  const sid = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn';
  const session: StoredSession = { email: 'owner@example.com', accessToken: 'access', expiresAt: Date.now() + 3600_000 };
  await kv.put(`session:${sid}`, await encryptJson(session, secret));
  const env: Env = { DUANOS_KV: kv, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: 'https://example.com/api/auth/callback', ALLOWED_GOOGLE_EMAIL: 'owner@example.com', SESSION_ENCRYPTION_KEY: secret };
  let appends = 0; let emails = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/drive/v3/files')) return Response.json({ files: [{ id: 'sheet-id', name: '个人记账｜口述版' }] });
    if (url.includes('/v4/spreadsheets/sheet-id?')) return Response.json({ sheets: [{ properties: { title: '记账流水' } }] });
    if (url.includes(':append')) { appends++; return Response.json({}); }
    if (url.includes('/messages/send')) { emails++; return emails === 1 ? new Response('{}', { status: 503 }) : Response.json({}); }
    return Response.json({});
  };
  try {
    const request = () => new Request('https://example.com/api/ledger', { method: 'POST', headers: { Origin: 'https://example.com', Cookie: `__Host-duanos_session=${sid}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal((await onRequestPost({ request: request(), env })).status, 202);
    assert.equal((await onRequestPost({ request: request(), env })).status, 200);
    assert.equal(appends, 1);
    assert.equal(emails, 2);
  } finally { globalThis.fetch = originalFetch; }
});
