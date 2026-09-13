export interface LedgerPayload {
  id: string;
  date: string;
  type: '支出' | '收入';
  category: string;
  amountCents: number;
  account: string;
  content: string;
  note: string;
  counterpartyAccount: string;
  recordedAt: string;
}

export function validateLedgerPayload(value: unknown): LedgerPayload {
  if (!value || typeof value !== 'object') throw new Error('INVALID_PAYLOAD');
  const p = value as Record<string, unknown>;
  if (typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(p.id)) throw new Error('INVALID_ID');
  if (typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || new Date(`${p.date}T00:00:00Z`).toISOString().slice(0, 10) !== p.date) throw new Error('INVALID_DATE');
  if (p.type !== '支出' && p.type !== '收入') throw new Error('INVALID_TYPE');
  if (!Number.isSafeInteger(p.amountCents) || (p.amountCents as number) <= 0 || (p.amountCents as number) > 10_000_000_000) throw new Error('INVALID_AMOUNT');
  for (const key of ['category', 'account', 'content', 'note', 'counterpartyAccount', 'recordedAt']) if (typeof p[key] !== 'string' || (p[key] as string).length > 4000) throw new Error(`INVALID_${key.toUpperCase()}`);
  if (!(p.account as string).trim() || !(p.content as string).trim() || !Number.isFinite(Date.parse(p.recordedAt as string))) throw new Error('INVALID_REQUIRED_FIELD');
  return p as unknown as LedgerPayload;
}

export function ledgerRow(p: LedgerPayload): Array<string | number> {
  const recordedAt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(p.recordedAt));
  return [p.date, p.type, p.category, (p.amountCents / 100).toFixed(2), p.account.trim(), p.content.trim(), p.note.trim(), p.counterpartyAccount.trim(), recordedAt];
}

export function sheetRange(title: string): string { return `'${title.replace(/'/g, "''")}'!A:I`; }
