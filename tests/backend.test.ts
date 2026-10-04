import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bridgeFailureCode, callBridge, canonicalMessage, signBridge } from '../functions/_lib/bridge.ts';
import { ledgerRow, validateLedgerPayload } from '../functions/_lib/ledger.ts';
import { base64url } from '../functions/_lib/security.ts';
import { onRequestPost as login } from '../functions/api/auth/login.ts';
import { onRequestPost as logout } from '../functions/api/auth/logout.ts';
import { onRequestPost as writeLedger } from '../functions/api/ledger.ts';
import type { Env, KVNamespaceLike, StoredSession } from '../functions/_lib/types.ts';

class MemoryKV implements KVNamespaceLike {
  data = new Map<string, string>();
  async get(key: string) { return this.data.get(key) ?? null; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
}
const payload = { id: 'stable-id-123', date: '2026-09-13', type: '支出' as const, category: '餐饮', amountCents: 2500, account: '微信零钱', content: '午饭', note: '', counterpartyAccount: '', recordedAt: '2026-09-13T00:00:00.000Z' };
const transferPayload = { ...payload, id: 'transfer-id-123', type: '转账' as const, category: '', amountCents: 1000, account: '工资卡', content: '工资卡转入微信钱包10元', counterpartyAccount: '微信零钱' };
const origin = 'https://example.com';
function envWith(overrides: Partial<Env> = {}): Env { return { DUANOS_KV: new MemoryKV(), APPS_SCRIPT_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec', APPS_SCRIPT_SHARED_SECRET: 'test-shared-secret-at-least-32-characters', DUANOS_OWNER_PASSWORD_HASH: '', ...overrides }; }
async function passwordHash(password: string): Promise<string> {
  const salt = new Uint8Array(16).fill(7); const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, material, 256);
  return `pbkdf2-sha256$100000$${base64url(salt)}$${base64url(new Uint8Array(bits))}`;
}
function post(path: string, body: unknown, cookie?: string, extra: HeadersInit = {}) { return new Request(`${origin}${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: JSON.stringify(body) }); }
async function putSession(kv: MemoryKV, id = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN') { const value: StoredSession = { createdAt: Date.now(), expiresAt: Date.now() + 3600_000 }; await kv.put(`session:${id}`, JSON.stringify(value)); return `__Host-duanos_session=${id}`; }

test('ledger validation and row order match the nine sheet columns', () => {
  assert.deepEqual(ledgerRow(validateLedgerPayload(payload)), ['2026-09-13', '支出', '餐饮', '25.00', '微信零钱', '午饭', '', '', '2026-09-13 08:00:00']);
  assert.throws(() => validateLedgerPayload({ ...payload, amountCents: -1 })); assert.throws(() => validateLedgerPayload({ ...payload, type: '退款' }));
});

test('ledger validation accepts valid transfers and rejects invalid account pairs', () => {
  assert.deepEqual(ledgerRow(validateLedgerPayload(transferPayload)), ['2026-09-13', '转账', '', '10.00', '工资卡', '工资卡转入微信钱包10元', '', '微信零钱', '2026-09-13 08:00:00']);
  assert.throws(() => validateLedgerPayload({ ...transferPayload, counterpartyAccount: '' }));
  assert.throws(() => validateLedgerPayload({ ...transferPayload, counterpartyAccount: '工资卡' }));
});

test('correct owner password creates an opaque server session; wrong password does not', async () => {
  const kv = new MemoryKV(); const env = envWith({ DUANOS_KV: kv, DUANOS_OWNER_PASSWORD_HASH: await passwordHash('correct horse battery staple') });
  assert.equal((await login({ request: post('/api/auth/login', { password: 'wrong' }), env })).status, 401);
  assert.equal([...kv.data.keys()].some(key => key.startsWith('session:')), false);
  const response = await login({ request: post('/api/auth/login', { password: 'correct horse battery staple' }), env });
  assert.equal(response.status, 200); assert.match(response.headers.get('Set-Cookie') ?? '', /HttpOnly; Secure; SameSite=Lax/);
  assert.equal([...kv.data.keys()].filter(key => key.startsWith('session:')).length, 1);
});

test('login throttles repeated failures without storing a raw IP', async () => {
  const kv = new MemoryKV(); const env = envWith({ DUANOS_KV: kv, DUANOS_OWNER_PASSWORD_HASH: 'invalid' }); let response = new Response();
  for (let attempt = 0; attempt < 5; attempt++) response = await login({ request: post('/api/auth/login', { password: 'wrong' }, undefined, { 'CF-Connecting-IP': '203.0.113.4', 'User-Agent': 'test-device' }), env });
  assert.equal(response.status, 429); assert.equal([...kv.data.keys()].some(key => key.includes('203.0.113.4')), false);
  assert.equal((await login({ request: post('/api/auth/login', { password: 'anything' }, undefined, { 'CF-Connecting-IP': '203.0.113.4', 'User-Agent': 'test-device' }), env })).status, 429);
});

test('logout deletes server session and rejects cross-origin requests', async () => {
  const kv = new MemoryKV(); const cookie = await putSession(kv); const env = envWith({ DUANOS_KV: kv });
  const evil = post('/api/auth/logout', {}, cookie); evil.headers.set('Origin', 'https://evil.example'); assert.equal((await logout({ request: evil, env })).status, 403);
  const response = await logout({ request: post('/api/auth/logout', {}, cookie), env });
  assert.equal(response.status, 200); assert.equal([...kv.data.keys()].some(key => key.startsWith('session:')), false); assert.match(response.headers.get('Set-Cookie') ?? '', /Max-Age=0/);
});

test('ledger requires a valid owner session', async () => { assert.equal((await writeLedger({ request: post('/api/ledger', payload), env: envWith() })).status, 401); });

test('HMAC signing matches a fixed vector and covers action and payload', async () => {
  const message = canonicalMessage(1726185600000, payload.id, 'ledger.append', payload);
  assert.equal(await signBridge('test-shared-secret-at-least-32-characters', message), '3GQMezCgSXeVL2KsEtcYX0yOlvV_wFiT8HagbqcQ-qk');
  assert.notEqual(await signBridge('test-shared-secret-at-least-32-characters', canonicalMessage(1726185600000, payload.id, 'ledger.receipt', payload)), '3GQMezCgSXeVL2KsEtcYX0yOlvV_wFiT8HagbqcQ-qk');
});

test('sequential retries are idempotent and never append or email twice', async () => {
  const kv = new MemoryKV(); const cookie = await putSession(kv); const env = envWith({ DUANOS_KV: kv }); const actions: string[] = []; const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => { actions.push((JSON.parse(String(init?.body)) as { action: string }).action); return Response.json({ ok: true }); };
  try { assert.equal((await writeLedger({ request: post('/api/ledger', payload, cookie), env })).status, 200); const second = await writeLedger({ request: post('/api/ledger', payload, cookie), env }); assert.equal((await second.json() as { duplicate: boolean }).duplicate, true); assert.deepEqual(actions, ['ledger.append', 'ledger.receipt']); }
  finally { globalThis.fetch = originalFetch; }
});

test('a receipt failure retries only receipt after sheet confirmation', async () => {
  const kv = new MemoryKV(); const cookie = await putSession(kv); const env = envWith({ DUANOS_KV: kv }); let appends = 0; let receipts = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => { const action = (JSON.parse(String(init?.body)) as { action: string }).action; if (action === 'ledger.append') appends++; else receipts++; return action === 'ledger.receipt' && receipts === 1 ? Response.json({ ok: false }) : Response.json({ ok: true }); };
  try { assert.equal((await writeLedger({ request: post('/api/ledger', payload, cookie), env })).status, 202); assert.equal((await writeLedger({ request: post('/api/ledger', payload, cookie), env })).status, 200); assert.equal(appends, 1); assert.equal(receipts, 2); }
  finally { globalThis.fetch = originalFetch; }
});

async function runAppsScript(request: unknown): Promise<{ ok: boolean; error?: string }> {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'));
  const context = vm.createContext({
    input: request, console: { error() {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput(text: string) { return { text, setMimeType() { return this; } }; } },
    PropertiesService: { getScriptProperties() { return { getProperty(name: string) { return name === 'DUANOS_BRIDGE_SECRET' ? 'test-shared-secret-at-least-32-characters' : null; } }; } },
  });
  vm.runInContext(source, context);
  const result = vm.runInContext('doPost({postData:{contents:JSON.stringify(input)}}).text', context) as string;
  return JSON.parse(result) as { ok: boolean; error?: string };
}

test('Apps Script rejects stale timestamps, malformed payloads and bad signatures', async () => {
  assert.deepEqual(await runAppsScript({ timestamp: Date.now() - 600_000, requestId: payload.id, action: 'ledger.append', payload, signature: 'bad' }), { ok: false, error: 'STALE_REQUEST' });
  assert.deepEqual(await runAppsScript({ timestamp: Date.now(), requestId: payload.id, action: 'unknown', payload, signature: 'bad' }), { ok: false, error: 'INVALID_REQUEST' });
  assert.deepEqual(await runAppsScript({ timestamp: Date.now(), requestId: payload.id, action: 'ledger.append', payload: { ...payload, amountCents: -1 }, signature: 'bad' }), { ok: false, error: 'INVALID_REQUEST' });
});

test('Apps Script accepts transfer structure and formats a clear transfer receipt', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'));
  const context = vm.createContext({ input: transferPayload }); vm.runInContext(source, context);
  assert.equal(vm.runInContext('validPayload_(input, input.id)', context), true);
  assert.equal(vm.runInContext("validPayload_(Object.assign({}, input, {counterpartyAccount: ''}), input.id)", context), false);
  assert.equal(vm.runInContext("validPayload_(Object.assign({}, input, {counterpartyAccount: input.account}), input.id)", context), false);
  assert.match(vm.runInContext('receiptBody_(input)', context) as string, /转账｜10\.00 元｜工资卡 → 微信零钱/);
  context.input = payload;
  assert.equal(vm.runInContext('receiptBody_(input)', context), '已写入记账流水：2026-09-13｜支出｜25.00 元｜午饭');
});

test('Apps Script source contains no real configuration', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'));
  assert.match(source, /INVALID_SIGNATURE/); assert.match(source, /ALLOWED_ACTIONS/); assert.doesNotMatch(source, /@gmail\.com|docs\.google\.com\/spreadsheets/);
});

test('bridge stages survive the ledger API without exposing sensitive context', async (t) => {
  const sensitive = ['https://script.google.com/macros/s/private-deployment/exec', 'private-shared-secret-at-least-32-characters', 'private-signature', 'private-cookie', 'private-owner-password', 'private-oauth-token'];
  const raw = sensitive.join(' ');
  const cases = [
    { name: 'missing URL', overrides: { APPS_SCRIPT_WEB_APP_URL: undefined }, code: 'BRIDGE_CONFIG_ERROR' },
    ...['', 'not-a-url', 'http://script.google.com/macros/s/test/exec', 'https://evil.example/macros/s/test/exec', 'https://script.google.com/macros/s/test/dev'].map(url => ({ name: `invalid URL ${url}`, overrides: { APPS_SCRIPT_WEB_APP_URL: url }, code: 'BRIDGE_CONFIG_ERROR' })),
    { name: 'missing secret', overrides: { APPS_SCRIPT_SHARED_SECRET: undefined }, code: 'BRIDGE_CONFIG_ERROR' },
    { name: 'short secret', overrides: { APPS_SCRIPT_SHARED_SECRET: 'short' }, code: 'BRIDGE_CONFIG_ERROR' },
    { name: 'signing fails', signFails: true, code: 'BRIDGE_SIGN_ERROR' },
    { name: 'fetch throws', fetchFails: true, code: 'BRIDGE_FETCH_ERROR' },
    { name: 'HTTP 503 with non-JSON body', response: () => new Response(raw, { status: 503 }), code: 'BRIDGE_HTTP_ERROR' },
    { name: 'HTTP 403 with JSON rejection', response: () => Response.json({ ok: false, error: raw }, { status: 403 }), code: 'BRIDGE_HTTP_ERROR' },
    { name: 'non-JSON response', response: () => new Response(raw), code: 'BRIDGE_JSON_ERROR' },
    ...['INVALID_SIGNATURE', 'INVALID_REQUEST', 'STALE_REQUEST', 'NOT_CONFIGURED', 'LEDGER_SHEET_NOT_FOUND', 'SHEET_NOT_WRITTEN'].map(error => ({ name: `remote ${error}`, response: () => Response.json({ ok: false, error, context: raw, stack: raw }), code: `BRIDGE_REMOTE_${error}` })),
    ...['BRIDGE_REQUEST_FAILED', raw, '__proto__', 'constructor', 'INVALID_SIGNATURE extra', ' INVALID_SIGNATURE'].map(error => ({ name: `unknown remote ${error.split(' ')[0]}`, response: () => Response.json({ ok: false, error, context: raw, stack: raw }), code: 'BRIDGE_REMOTE_ERROR' })),
    ...[null, 123, { message: 'INVALID_SIGNATURE' }, ['INVALID_SIGNATURE']].map((error, i) => ({ name: `non-string remote ${i}`, response: () => Response.json({ ok: false, error }), code: 'BRIDGE_REMOTE_ERROR' })),
    ...[null, {}, [], { ok: 'true' }].map((value, i) => ({ name: `invalid result shape ${i}`, response: () => Response.json(value), code: 'BRIDGE_REMOTE_ERROR' })),
  ];
  for (const scenario of cases) await t.test(scenario.name, async (st) => {
    const kv = new MemoryKV(); const cookie = await putSession(kv);
    const env = envWith({ DUANOS_KV: kv, APPS_SCRIPT_WEB_APP_URL: sensitive[0], APPS_SCRIPT_SHARED_SECRET: sensitive[1], DUANOS_OWNER_PASSWORD_HASH: sensitive[4], ...('overrides' in scenario ? scenario.overrides : {}) });
    let fetched = false;
    st.mock.method(globalThis, 'fetch', async () => {
      fetched = true;
      if ('fetchFails' in scenario) throw new Error(raw);
      return 'response' in scenario && scenario.response ? scenario.response() : Response.json({ ok: true });
    });
    if ('signFails' in scenario) st.mock.method(crypto.subtle, 'importKey', async () => { throw new Error(raw); });
    try {
      await assert.rejects(callBridge(env, 'ledger.append', payload), error => {
        assert.equal(bridgeFailureCode(error), scenario.code);
        assert.equal((error as Error).message, scenario.code);
        assert.equal((error as Error & { cause?: unknown }).cause, undefined);
        return true;
      });
      const response = await writeLedger({ request: post('/api/ledger', payload, cookie, { Authorization: `Bearer ${sensitive[5]}` }), env });
      assert.equal(response.status, 502);
      const body = await response.text();
      assert.deepEqual(JSON.parse(body), { ok: false, error: scenario.code });
      for (const value of [...sensitive, cookie]) assert.equal(body.includes(value), false);
      assert.equal(kv.data.has(`ledger:${payload.id}`), false);
      assert.equal(fetched, !('overrides' in scenario || 'signFails' in scenario));
    } finally { st.mock.restoreAll(); }
  });
  assert.equal(bridgeFailureCode(new Error(raw)), 'SYNC_FAILED');
  assert.equal(bridgeFailureCode(new Error('BRIDGE_FETCH_ERROR')), 'SYNC_FAILED');
});

test('bridge success keeps signed request and redirect behavior', async (t) => {
  const env = envWith();
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, env.APPS_SCRIPT_WEB_APP_URL);
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'follow');
    assert.deepEqual(init?.headers, { 'Content-Type': 'text/plain;charset=utf-8' });
    const request = JSON.parse(String(init?.body));
    assert.equal(request.requestId, payload.id); assert.equal(request.action, 'ledger.append');
    assert.deepEqual(request.payload, payload);
    assert.equal(request.signature, await signBridge(env.APPS_SCRIPT_SHARED_SECRET, canonicalMessage(request.timestamp, payload.id, request.action, payload)));
    return Response.json({ ok: true, duplicate: false });
  });
  await callBridge(env, 'ledger.append', payload);
});

test('failed append retries with the same id; income, expense and transfer keep idempotency', async (t) => {
  for (const p of [payload, { ...payload, type: '收入' as const }, transferPayload]) await t.test(p.type, async (st) => {
    const kv = new MemoryKV(); const cookie = await putSession(kv); const env = envWith({ DUANOS_KV: kv });
    const requests: Array<{ action: string; requestId: string; payload: typeof p }> = [];
    st.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: requests.length > 1 });
    });
    try {
      const failed = await writeLedger({ request: post('/api/ledger', p, cookie), env });
      assert.deepEqual(await failed.json(), { ok: false, error: 'BRIDGE_REMOTE_ERROR' });
      assert.equal(kv.data.has(`ledger:${p.id}`), false);
      const success = await writeLedger({ request: post('/api/ledger', p, cookie), env });
      assert.equal(success.status, 200); assert.deepEqual(await success.json(), { ok: true, duplicate: false, receiptSent: true });
      const duplicate = await writeLedger({ request: post('/api/ledger', p, cookie), env });
      assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true, receiptSent: true });
      assert.deepEqual(requests.map(r => r.action), ['ledger.append', 'ledger.append', 'ledger.receipt']);
      assert.equal(requests.every(r => r.requestId === p.id), true);
      assert.equal(requests.every(r => JSON.stringify(r.payload) === JSON.stringify(p)), true);
      assert.equal(kv.data.get(`ledger:${p.id}`), 'complete');
    } finally { st.mock.restoreAll(); }
  });
});
