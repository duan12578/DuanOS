import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerPayload, syncLedgerEntry } from '../src/cloud.ts';
import { pendingSyncCount, updateSync } from '../src/sync.ts';
import { decodeEntries, makeEntry, recognize } from '../src/domain.ts';
import { bridgeErrorCodes, safeSyncErrorCode, syncErrorLabel } from '../src/sync-errors.ts';

const now = new Date('2026-09-13T00:00:00Z');
test('ledger payload keeps the stable local id and positive cents', () => {
  const entry = makeEntry(recognize('微信支付午饭25元', now), 'stable-id-123', now);
  assert.deepEqual(ledgerPayload(entry), { id: 'stable-id-123', date: '2026-09-13', type: '支出', category: '', amountCents: 2500, account: '微信零钱', content: '微信支付午饭25元', note: '', counterpartyAccount: '', recordedAt: now.toISOString() });
});

test('transfer payload keeps source and destination accounts', () => {
  const entry = makeEntry(recognize('工资卡转入微信钱包10元', now), 'transfer-id-123', now);
  assert.deepEqual(ledgerPayload(entry), { id: 'transfer-id-123', date: '2026-09-13', type: '转账', category: '', amountCents: 1000, account: '工资卡', content: '工资卡转入微信钱包10元', note: '', counterpartyAccount: '微信零钱', recordedAt: now.toISOString() });
});

test('sync transitions preserve the local record and expose pending count', () => {
  const entry = makeEntry(recognize('微信支付午饭25元', now), 'stable-id-123', now);
  const syncing = updateSync([entry], entry.id, 'syncing');
  const failed = updateSync(syncing, entry.id, 'error', 'network');
  assert.equal(failed[0].text, entry.text);
  assert.equal(failed[0].syncError, 'network');
  assert.equal(pendingSyncCount(failed), 1);
  assert.equal(pendingSyncCount(updateSync(failed, entry.id, 'synced')), 0);
});

test('cloud keeps only allowlisted codes through persistence and display', async (t) => {
  const entry = makeEntry(recognize('工资卡转入微信钱包10元', now), 'transfer-id-123', now);
  const raw = 'https://private.example secret=private-secret signature=private-signature Cookie=private-cookie password=private-password token=private-token';
  for (const code of [...bridgeErrorCodes, 'UNAUTHENTICATED', 'IN_PROGRESS']) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error: code, context: raw }, { status: 502 }));
    await assert.rejects(syncLedgerEntry(entry), { message: code });
    const stored = decodeEntries(JSON.stringify(updateSync([entry], entry.id, 'error', code)));
    assert.equal(stored[0].id, entry.id); assert.equal(stored[0].syncError, code);
    assert.equal(syncErrorLabel(stored[0].syncError), `同步失败（${code}）`);
    t.mock.restoreAll();
  }
  for (const error of [raw, `BRIDGE_FETCH_ERROR ${raw}`, null, { message: raw }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error }, { status: 502 }));
    await assert.rejects(syncLedgerEntry(entry), { message: 'SYNC_FAILED' });
    assert.equal(safeSyncErrorCode(error), 'SYNC_FAILED');
    assert.equal(syncErrorLabel(error), '同步失败（SYNC_FAILED）');
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json(null, { status: 502 }));
  await assert.rejects(syncLedgerEntry(entry), { message: 'SYNC_FAILED' });
});

test('cloud success and receipt retry results are unchanged', async (t) => {
  const entry = makeEntry(recognize('微信支付午饭25元', now), 'stable-id-123', now);
  for (const receiptSent of [true, false]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, receiptSent, ...(receiptSent ? {} : { error: 'RECEIPT_FAILED' }) }, { status: receiptSent ? 200 : 202 }));
    assert.deepEqual(await syncLedgerEntry(entry), { receiptSent });
    t.mock.restoreAll();
  }
  assert.equal(syncErrorLabel('表格已同步，回执邮件待重试'), '同步失败 · 表格已同步，回执邮件待重试');
});
