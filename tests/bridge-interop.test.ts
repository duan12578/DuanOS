import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { canonicalLedger, canonicalMessage, signBridge } from '../functions/_lib/bridge.ts';
import { ledgerRow, validateLedgerPayload } from '../functions/_lib/ledger.ts';
import type { LedgerPayload } from '../functions/_lib/ledger.ts';
import { onRequestPost as writeLedger } from '../functions/api/ledger.ts';
import type { Env } from '../functions/_lib/types.ts';

const source = await readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const secret = 'mock-only-shared-secret-at-least-32-characters';
const transfer: LedgerPayload = { id: 'isolated-transfer-123', date: '2026-10-04', type: '转账', category: '', amountCents: 1000, account: '工资卡', content: '工资卡转入微信钱包10元', note: '', counterpartyAccount: '微信零钱', recordedAt: '2026-10-04T05:26:00.000Z' };
const samples: LedgerPayload[] = [transfer, { ...transfer, id: 'isolated-income-123', type: '收入', counterpartyAccount: '' }, { ...transfer, id: 'isolated-expense-123', type: '支出', counterpartyAccount: '' }];
const sensitive = 'https://private.example mock-secret mock-signature mock-cookie mock-token mock-owner-password mock-spreadsheet-id mock-receipt-email';

function script(overrides: { properties?: Record<string, string>; missingSheet?: boolean; mailFailsOnce?: boolean; failure?: unknown } = {}) {
  const properties = new Map(Object.entries({ DUANOS_BRIDGE_SECRET: secret, SPREADSHEET_ID: 'mock-spreadsheet-id', RECEIPT_EMAIL: 'mock-receipt-email', ...overrides.properties }));
  const rows: unknown[][] = []; const mails: unknown[][] = []; const logs: unknown[][] = []; const signedMessages: string[] = [];
  let failures = overrides.mailFailsOnce ? 1 : 0;
  const context = vm.createContext({
    console: { error: (...args: unknown[]) => logs.push(args) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput(text: string) { return { text, setMimeType() { return this; } }; } },
    PropertiesService: { getScriptProperties() { if (overrides.failure !== undefined) throw overrides.failure; return { getProperty(key: string) { return properties.get(key) ?? null; }, setProperty(key: string, value: string) { properties.set(key, value); } }; } },
    Utilities: {
      computeHmacSha256Signature(message: string, key: string) {
        signedMessages.push(message);
        // Apps Script's default string encoding is UTF-8; signed bytes model its Byte[].
        return [...createHmac('sha256', Buffer.from(key, 'utf8')).update(Buffer.from(message, 'utf8')).digest()].map(b => b > 127 ? b - 256 : b);
      },
      base64EncodeWebSafe(bytes: number[]) { return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); },
      formatDate(date: Date) { return new Date(date.getTime() + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19); },
    },
    LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
    SpreadsheetApp: { openById(id: string) { assert.equal(id, 'mock-spreadsheet-id'); return { getSheetByName(name: string) { assert.equal(name, '记账流水'); return overrides.missingSheet ? null : { appendRow(row: unknown[]) { rows.push(Array.from(row)); } }; } }; } },
    MailApp: { sendEmail(...args: unknown[]) { if (failures-- > 0) throw new Error(sensitive); mails.push(args); } },
  });
  vm.runInContext(source, context);
  function evaluate(expression: string, input: unknown) { context.input = input; return vm.runInContext(expression, context); }
  function post(input: unknown): { ok: boolean; error?: string; duplicate?: boolean } { return JSON.parse(evaluate('doPost({postData:{contents:JSON.stringify(input)}}).text', input)); }
  return { context, evaluate, post, properties, rows, mails, logs, signedMessages };
}

async function request(p: LedgerPayload = transfer, action: 'ledger.append' | 'ledger.receipt' = 'ledger.append', timestamp = Date.now()) {
  return { timestamp, requestId: p.id, action, payload: p, signature: await signBridge(secret, canonicalMessage(timestamp, p.id, action, p)) };
}

test('Cloudflare and Apps Script canonical payload/message/UTF-8 HMAC agree across ledger types and actions', async () => {
  const remote = script();
  const unicode = { ...transfer, content: '工资卡转入微信钱包10元 “核对” 😀\n\t"\\', note: '备注：é\u2028' };
  for (const p of [...samples, unicode]) {
    // Request key order and unused properties must not affect canonical signing.
    const reordered = Object.fromEntries(Object.entries({ ...p, extra: 'ignored' }).reverse()) as unknown as LedgerPayload;
    assert.equal(remote.evaluate('canonicalPayload_(input)', reordered), canonicalLedger(p));
    assert.equal(remote.evaluate('validPayload_(input, input.id)', p), true);
    assert.deepEqual(validateLedgerPayload(p), p);
    assert.deepEqual(JSON.parse(JSON.stringify(remote.evaluate('ledgerRow_(input)', p))), ledgerRow(p));
    for (const action of ['ledger.append', 'ledger.receipt'] as const) {
      const signed = await request(reordered, action, 1791091560000);
      const message = canonicalMessage(signed.timestamp, p.id, action, p);
      assert.equal(remote.evaluate('canonicalMessage_(input)', signed), message);
      const signature = remote.evaluate('signature_(input.secret, input.message)', { secret, message });
      assert.equal(signature, signed.signature);
      assert.equal(signature, createHmac('sha256', secret).update(message, 'utf8').digest('base64url'));
      assert.match(signature, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(remote.signedMessages.at(-1), message);
    }
  }
});

test('Apps Script returns only fixed safe rejection codes and never writes for rejected requests', async () => {
  const valid = await request();
  const cases: Array<{ options?: Parameters<typeof script>[0]; input: unknown; code: string }> = [
    { options: { properties: { DUANOS_BRIDGE_SECRET: '' } }, input: valid, code: 'NOT_CONFIGURED' },
    { input: { ...valid, timestamp: Date.now() - 300_001 }, code: 'STALE_REQUEST' },
    { input: { ...valid, timestamp: Date.now() + 600_000 }, code: 'STALE_REQUEST' },
    { input: { ...valid, action: 'unknown' }, code: 'INVALID_REQUEST' },
    { input: { ...valid, requestId: 'invalid!id' }, code: 'INVALID_REQUEST' },
    { input: { ...valid, payload: { ...transfer, amountCents: 0 } }, code: 'INVALID_REQUEST' },
    { input: { ...valid, payload: { ...transfer, counterpartyAccount: '' } }, code: 'INVALID_REQUEST' },
    { input: { ...valid, signature: sensitive }, code: 'INVALID_SIGNATURE' },
    { options: { properties: { SPREADSHEET_ID: '' } }, input: valid, code: 'NOT_CONFIGURED' },
    { options: { missingSheet: true }, input: valid, code: 'LEDGER_SHEET_NOT_FOUND' },
    { input: await request(transfer, 'ledger.receipt'), code: 'SHEET_NOT_WRITTEN' },
    { options: { properties: { RECEIPT_EMAIL: '', ['ledger:' + transfer.id]: 'sheet_written' } }, input: await request(transfer, 'ledger.receipt'), code: 'NOT_CONFIGURED' },
    ...[new Error(sensitive), sensitive, { message: ['INVALID_SIGNATURE'] }, { message: 'INVALID_SIGNATURE ' + sensitive }, { message: '__proto__' }].map(failure => ({ options: { failure }, input: valid, code: 'BRIDGE_REQUEST_FAILED' })),
  ];
  for (const c of cases) {
    const remote = script(c.options);
    assert.deepEqual(remote.post(c.input), { ok: false, error: c.code });
    assert.deepEqual(remote.logs, [['Bridge request failed: %s', c.code]]);
    assert.equal(remote.rows.length, 0); assert.equal(remote.mails.length, 0);
    assert.equal(remote.properties.get('ledger:' + transfer.id), c.options?.properties?.['ledger:' + transfer.id]);
  }
});

test('signature rejects padding, a different shared secret, and changes to every signed field', async () => {
  const signed = await request();
  const changes = [
    { ...signed, signature: signed.signature + '=' },
    { ...signed, signature: await signBridge(secret + '-different', canonicalMessage(signed.timestamp, transfer.id, 'ledger.append', transfer)) },
    { ...signed, timestamp: signed.timestamp - 1000 },
    { ...signed, action: 'ledger.receipt' },
    { ...signed, requestId: 'changed-transfer-123', payload: { ...transfer, id: 'changed-transfer-123' } },
    ...Object.entries({ date: '2026-10-03', type: '支出', category: 'other', amountCents: 1001, account: '银行卡', content: 'different content', note: 'different note', counterpartyAccount: '支付宝', recordedAt: '2026-10-04T05:26:01.000Z' }).map(([key, value]) => ({ ...signed, payload: { ...transfer, [key]: value } })),
  ];
  for (const changed of changes) {
    const remote = script();
    assert.deepEqual(remote.post(changed), { ok: false, error: 'INVALID_SIGNATURE' });
    assert.equal(remote.rows.length, 0); assert.equal(remote.mails.length, 0);
  }
});

test('full mocked Cloudflare → Apps Script flow preserves append and receipt idempotency for transfer/income/expense', async (t) => {
  for (const p of samples) await t.test(p.type, async (st) => {
    const remote = script({ mailFailsOnce: true });
    const kv = new Map<string, string>();
    const sessionId = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    kv.set('session:' + sessionId, JSON.stringify({ createdAt: Date.now(), expiresAt: Date.now() + 3600_000 }));
    const env: Env = { DUANOS_KV: { async get(k) { return kv.get(k) ?? null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); } }, APPS_SCRIPT_SHARED_SECRET: secret, APPS_SCRIPT_WEB_APP_URL: 'https://script.google.com/macros/s/mock-only/exec', DUANOS_OWNER_PASSWORD_HASH: '' };
    const actions: string[] = [];
    st.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)); actions.push(body.action);
      return Response.json(remote.post(body));
    });
    const api = () => writeLedger({ env, request: new Request('https://mock.example/api/ledger', { method: 'POST', headers: { Origin: 'https://mock.example', Cookie: '__Host-duanos_session=' + sessionId, 'Content-Type': 'application/json' }, body: JSON.stringify(p) }) });
    try {
      const first = await api(); assert.equal(first.status, 202);
      assert.deepEqual(await first.json(), { ok: true, duplicate: false, receiptSent: false, error: 'RECEIPT_FAILED' });
      assert.equal(kv.get('ledger:' + p.id), 'sheet_written');
      assert.equal(remote.properties.get('ledger:' + p.id), 'sheet_written');
      assert.equal(remote.rows.length, 1); assert.equal(remote.mails.length, 0);
      const retry = await api(); assert.equal(retry.status, 200);
      assert.deepEqual(await retry.json(), { ok: true, duplicate: true, receiptSent: true });
      assert.equal(kv.get('ledger:' + p.id), 'complete');
      await api(); assert.deepEqual(actions, ['ledger.append', 'ledger.receipt', 'ledger.receipt']);
      // Simulate missing local KV confirmation; remote state still prevents duplicate writes/mail.
      kv.delete('ledger:' + p.id); await api();
      assert.equal(remote.rows.length, 1); assert.equal(remote.mails.length, 1);
      assert.equal(remote.properties.get('ledger:' + p.id), 'complete');
      assert.deepEqual(remote.rows[0], ledgerRow(p));
      if (p.type === '转账') assert.match(String(remote.mails[0][2]), /工资卡 → 微信零钱/);
      assert.deepEqual(remote.logs, [['Bridge request failed: %s', 'BRIDGE_REQUEST_FAILED']]);
    } finally { st.mock.restoreAll(); }
  });
});

test('repository manifest preserves existing Web App identity/access and OAuth scopes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../apps-script/appsscript.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.send_mail']);
});
