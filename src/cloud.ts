import type { Entry } from './domain';

export type CloudStatus = { ok: boolean; authenticated: boolean; email: string | null };

export function ledgerPayload(entry: Entry) {
  if (entry.kind !== 'ledger' || !entry.amountCents || !entry.account || !entry.direction) throw new Error('INVALID_LEDGER_ENTRY');
  return {
    id: entry.id,
    date: entry.date,
    type: entry.direction === 'income' ? '收入' as const : '支出' as const,
    category: '',
    amountCents: entry.amountCents,
    account: entry.account,
    content: entry.text,
    note: '',
    counterpartyAccount: '',
    recordedAt: entry.createdAt,
  };
}

export async function fetchCloudStatus(): Promise<CloudStatus> {
  const response = await fetch('/api/health', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('HEALTH_FAILED');
  return response.json();
}

export async function syncLedgerEntry(entry: Entry): Promise<{ receiptSent: boolean }> {
  const response = await fetch('/api/ledger', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(ledgerPayload(entry)) });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; receiptSent?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || 'SYNC_FAILED');
  return { receiptSent: result.receiptSent !== false };
}
