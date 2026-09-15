import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerPayload } from '../src/cloud.ts';
import { pendingSyncCount, updateSync } from '../src/sync.ts';
import { makeEntry, recognize } from '../src/domain.ts';

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
