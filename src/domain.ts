export const kinds = ['ledger', 'todo', 'reminder', 'review'] as const;
export type Kind = typeof kinds[number];
export const labels: Record<Kind, string> = { ledger: '记账', todo: '待办', reminder: '定时提醒', review: '每日复盘' };
export type Draft = { kind: Kind | null; text: string; amount: string; account: string; direction: 'expense' | 'income'; time: string; date: string };
export type SyncState = 'local' | 'syncing' | 'synced' | 'error';
export type Entry = { id: string; kind: Kind; text: string; createdAt: string; date: string; amountCents?: number; account?: string; direction?: 'expense' | 'income'; dueAt?: string; done: boolean; notificationId?: string; notificationState?: 'scheduled' | 'unavailable' | 'cancelled'; syncState: SyncState; syncError?: string };

export function beijingDate(now = new Date()): string { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
export function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function parseTime(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match || !validDate(match[1]) || +match[2] > 23 || +match[3] > 59) return;
  return new Date(`${match[1]}T${match[2]}:${match[3]}:00+08:00`).toISOString();
}
export function moneyCents(value: string): number | undefined {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 10000000000 ? cents : undefined;
}
export function recognize(text: string, now = new Date()): Draft {
  const source = text.trim();
  let kind: Kind | null = null;
  if (/每日复盘|今天的复盘|复盘一下|复盘[:：]|记录今天/.test(source)) kind = 'review';
  else if (/提醒|闹钟/.test(source) && !/不需要提醒|不用提醒|无需提醒/.test(source)) kind = 'reminder';
  else if (/待办|任务|记得|要做|不需要提醒|不用提醒/.test(source)) kind = 'todo';
  else if (/记账|支付|支出|收入|花了|买了|元|块|工资到账/.test(source)) kind = 'ledger';
  if (/^(咨询|假设|举例|测试不执行)/.test(source)) kind = null;
  const amount = source.match(/(?:收入|支出|支付|花了|金额)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/)?.[1]
    ?? source.match(/(\d+(?:\.\d+)?)\s*(?:元|块)/)?.[1] ?? '';
  const account = source.match(/工资卡|信用卡|微信零钱|支付宝|现金|银行卡|微信支付|微信/)?.[0] ?? '';
  let date = beijingDate(now);
  if (/昨天/.test(source)) date = beijingDate(new Date(now.getTime() - 86400000));
  const explicit = source.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (explicit) date = explicit;
  let time = source.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)?.[0] ?? '';
  // Only unambiguous numeric clock expressions; Chinese clock words can be filled in below.
  if (!time && kind === 'reminder' && !/每|周[一二三四五六日天]|月|\d+号|\d+日/.test(source)) {
    const clock = source.match(/(\d{1,2})(?:[:：](\d{2})|点(半|\d{1,2}分?)?)/);
    if (clock) {
      let h = +clock[1]; const m = clock[2] ? +clock[2] : clock[3] === '半' ? 30 : parseInt(clock[3] || '0');
      if (/下午|晚上|今晚/.test(source) && h < 12) h += 12;
      if (/凌晨/.test(source) && h === 12) h = 0;
      const dayOffset = /后天/.test(source) ? 2 : /明天|明早|明晚/.test(source) ? 1 : 0;
      const d = explicit ?? beijingDate(new Date(now.getTime() + dayOffset * 86400000));
      time = `${d} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  return { kind, text: source, amount, account: /微信/.test(account) ? '微信零钱' : account, direction: /收入|到账/.test(source) ? 'income' : 'expense', time, date };
}
export function validate(d: Draft, now = new Date()): string | undefined {
  if (!d.kind) return '请选择一类记录。';
  if (!d.text.trim()) return '请输入记录内容。';
  if (d.text.length > 4000) return '内容最多 4000 字，请分条记录。';
  if (!validDate(d.date)) return '请填写有效日期，格式为 YYYY-MM-DD。';
  if (d.kind === 'ledger') {
    if ((d.text.match(/\d+(?:\.\d+)?\s*(?:元|块)/g) ?? []).length > 1) return '检测到多个金额，请拆成多条记录，避免误记。';
    if (/退款|还款|转账/.test(d.text)) return 'v0.1.1 暂不处理退款、还款或转账，请在原记账系统操作。';
    if (!moneyCents(d.amount)) return '请输入大于 0、最多两位小数的金额（上限一亿元）。';
    if (!d.account.trim()) return '请补充付款或收款账户。';
  }
  if (d.kind === 'reminder') {
    if (/每天|每日|每周|每月|每年|循环/.test(d.text)) return '此版本支持单次提醒，循环提醒请在原待办系统设置。';
    const due = parseTime(d.time);
    if (!due) return '请填写北京时间，例如 2026-09-13 20:00。';
    if (new Date(due).getTime() <= now.getTime()) return '提醒时间必须晚于现在。';
  }
}
export function makeEntry(d: Draft, id: string, now = new Date()): Entry {
  const error = validate(d, now); if (error) throw new Error(error);
  return { id, kind: d.kind!, text: d.text.trim(), createdAt: now.toISOString(), date: d.date, done: false, syncState: 'local',
    ...(d.kind === 'ledger' ? { amountCents: moneyCents(d.amount), account: d.account.trim(), direction: d.direction } : {}),
    ...(d.kind === 'reminder' ? { dueAt: parseTime(d.time) } : {}) };
}
export function totals(entries: Entry[], date?: string) {
  return entries.filter(e => e.kind === 'ledger' && (!date || e.date === date)).reduce((s, e) => {
    s[e.direction === 'income' ? 'income' : 'expense'] += e.amountCents ?? 0; return s;
  }, { income: 0, expense: 0 });
}
export function decodeEntries(raw: string | null): Entry[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every(e => e && typeof e.id === 'string' && kinds.includes(e.kind) && typeof e.text === 'string' && typeof e.done === 'boolean' && validDate(e.date) && typeof e.createdAt === 'string' && Number.isFinite(Date.parse(e.createdAt)) && (e.syncState === undefined || ['local', 'syncing', 'synced', 'error'].includes(e.syncState)) && (e.kind !== 'ledger' || (Number.isSafeInteger(e.amountCents) && e.amountCents > 0 && typeof e.account === 'string' && ['income', 'expense'].includes(e.direction))) && (e.kind !== 'reminder' || (typeof e.dueAt === 'string' && Number.isFinite(Date.parse(e.dueAt)))))) throw new Error('本地数据格式异常，已停止写入以保护原始数据。');
  if (new Set(value.map(e => e.id)).size !== value.length) throw new Error('本地记录编号重复，已停止写入。');
  return value.map(e => ({ ...e, syncState: e.syncState ?? 'local' }));
}
