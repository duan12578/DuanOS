import type { Env } from './types.ts';
import type { LedgerPayload } from './ledger.ts';
import { base64url, utf8 } from './security.ts';

export type BridgeAction = 'ledger.append' | 'ledger.receipt';
export function canonicalLedger(p: LedgerPayload): string { return JSON.stringify({ id: p.id, date: p.date, type: p.type, category: p.category, amountCents: p.amountCents, account: p.account, content: p.content, note: p.note, counterpartyAccount: p.counterpartyAccount, recordedAt: p.recordedAt }); }
export function canonicalMessage(timestamp: number, requestId: string, action: BridgeAction, payload: LedgerPayload): string { return `${timestamp}\n${requestId}\n${action}\n${canonicalLedger(payload)}`; }
export async function signBridge(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(message))));
}
function bridgeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) throw new Error('BRIDGE_NOT_CONFIGURED');
  return url.toString();
}
export async function callBridge(env: Env, action: BridgeAction, payload: LedgerPayload): Promise<void> {
  if (!env.APPS_SCRIPT_SHARED_SECRET || env.APPS_SCRIPT_SHARED_SECRET.length < 32) throw new Error('BRIDGE_NOT_CONFIGURED');
  const timestamp = Date.now(); const requestId = payload.id;
  const signature = await signBridge(env.APPS_SCRIPT_SHARED_SECRET, canonicalMessage(timestamp, requestId, action, payload));
  const response = await fetch(bridgeUrl(env.APPS_SCRIPT_WEB_APP_URL), { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ timestamp, requestId, action, payload, signature }) });
  const result = await response.json().catch(() => ({})) as { ok?: boolean };
  if (!response.ok || !result.ok) throw new Error('BRIDGE_REQUEST_FAILED');
}
