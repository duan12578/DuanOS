import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beijingDate, decodeEntries, makeEntry, moneyCents, parseTime, recognize, totals, validate } from '../src/domain.ts';
const now = new Date('2026-09-12T14:00:00Z');
test('recognizes the four intents without a network or provider key', () => {
  assert.equal(recognize('微信支付午饭25元', now).kind, 'ledger');
  assert.equal(recognize('待办：明天拿快递，不需要提醒', now).kind, 'todo');
  assert.equal(recognize('明天晚上8点提醒我背英语单词', now).kind, 'reminder');
  assert.equal(recognize('每日复盘：今天买了书，花了25元', now).kind, 'review');
});
test('ambiguous inputs require manual classification', () => {
  assert.equal(recognize('你好', now).kind, null);
  assert.equal(recognize('假设我支付25元', now).kind, null);
});
test('dates and reminders use Beijing time independent of device timezone', () => {
  assert.equal(beijingDate(new Date('2026-09-12T17:00:00Z')), '2026-09-13');
  assert.equal(recognize('明天晚上8点提醒我背英语单词', now).time, '2026-09-13 20:00');
  assert.equal(parseTime('2026-09-13 20:00'), '2026-09-13T12:00:00.000Z');
  assert.equal(recognize('提醒我明早6点半带水杯', now).time, '2026-09-13 06:30');
  assert.equal(recognize('下周一8点提醒我拿快递', now).time, '');
  assert.equal(recognize('9月15日8点提醒我拿快递', now).time, '');
});
test('invalid dates and past reminders never reach scheduling', () => {
  assert.equal(parseTime('2026-02-30 20:00'), undefined);
  assert.equal(parseTime('2026-09-13 25:00'), undefined);
  assert.equal(parseTime('2026-09-13 20:99'), undefined);
  assert.ok(validate(recognize('今天8点提醒我喝水', now), now));
  assert.ok(validate(recognize('每天8点提醒我喝水', now), now));
});
test('ledger enforces amount precision and account; does not silently round', () => {
  for (const v of ['0', '-25', '12.345', 'NaN', 'Infinity', '1e3', '100000001']) assert.equal(moneyCents(v), undefined);
  assert.equal(moneyCents('0.29'), 29);
  const draft = recognize('微信支付12.345元', now);
  assert.equal(draft.amount, '12.345');
  assert.ok(validate(draft, now));
  assert.ok(validate(recognize('午饭25元', now), now));
  assert.equal(recognize('微信支付25元', now).account, '微信零钱');
});
test('transfers and refunds cannot accidentally count as income or expense', () => {
  assert.ok(validate(recognize('工资卡还款25元', now), now));
  assert.ok(validate(recognize('工资卡退款25元', now), now));
  assert.ok(validate(recognize('微信早餐5元午饭25元', now), now));
});
test('integer-cent totals and date filtering', () => {
  const one = makeEntry(recognize('微信支付0.10元', now), '1', now);
  const two = makeEntry(recognize('微信支付0.20元', now), '2', now);
  const three = makeEntry(recognize('工资卡收入30元', now), '3', now);
  assert.deepEqual(totals([one, two, three]), { income: 3000, expense: 30 });
  assert.deepEqual(totals([one, two, three], '2026-09-13'), { income: 0, expense: 0 });
});
test('persistence rejects corrupt data instead of overwriting it', () => {
  assert.deepEqual(decodeEntries(null), []);
  assert.throws(() => decodeEntries('{broken'));
  assert.throws(() => decodeEntries('[{"id":"1"}]'));
  const entry = makeEntry(recognize('待办：读书', now), '1', now);
  assert.deepEqual(decodeEntries(JSON.stringify([entry])), [entry]);
  assert.throws(() => decodeEntries(JSON.stringify([entry, entry])));
});
test('empty, oversized and unclassified entries cannot be created', () => {
  assert.throws(() => makeEntry(recognize('', now), '1', now));
  assert.ok(validate({ ...recognize('待办：读书', now), text: 'a'.repeat(4001) }, now));
});
