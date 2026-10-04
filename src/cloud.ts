import type { Entry } from './domain';
import { safeSyncErrorCode } from './sync-errors.ts';

export type CloudStatus = { ok: boolean; authenticated: boolean };

export async function loginOwner(password: string): Promise<void> {
  const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ password }) });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) throw new Error(result.error || 'LOGIN_FAILED');
}

export async function logoutOwner(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('LOGOUT_FAILED');
}

export function ledgerPayload(entry: Entry) {
  if (entry.kind !== 'ledger' || !entry.amountCents || !entry.account?.trim() || !entry.direction) throw new Error('INVALID_LEDGER_ENTRY');
  if (entry.direction === 'transfer' && (!entry.counterpartyAccount?.trim() || entry.account.trim() === entry.counterpartyAccount.trim())) throw new Error('INVALID_LEDGER_ENTRY');
  return {
    id: entry.id,
    date: entry.date,
    type: entry.direction === 'transfer' ? '转账' as const : entry.direction === 'income' ? '收入' as const : '支出' as const,
    category: '',
    amountCents: entry.amountCents,
    account: entry.account,
    content: entry.text,
    note: '',
    counterpartyAccount: entry.direction === 'transfer' ? entry.counterpartyAccount : '',
    recordedAt: entry.createdAt,
  };
}

export async function fetchCloudStatus(): Promise<CloudStatus> {
  const response = await fetch('/api/health', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('HEALTH_FAILED');
  return response.json();
}

export async function syncLedgerEntry(entry: Entry): Promise<{ receiptSent: boolean }> {
  // Build/validate before fetch so malformed local records retain their own code.
  const payload = ledgerPayload(entry);
  let response: Response;
  try { response = await fetch('/api/ledger', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) }); }
  catch { throw new Error('CLOUD_FETCH_ERROR'); }
  let result: { ok?: unknown; receiptSent?: unknown; error?: unknown } | null;
  try { result = await response.json(); }
  catch { throw new Error(response.ok ? 'CLOUD_JSON_ERROR' : 'CLOUD_HTTP_ERROR'); }
  if (!response.ok || result?.ok !== true) {
    const code = result?.error === undefined
      ? (response.ok ? 'CLOUD_RESPONSE_ERROR' : 'CLOUD_HTTP_ERROR')
      : safeSyncErrorCode(result.error);
    throw new Error(code);
  }
  return { receiptSent: result.receiptSent !== false };
}
