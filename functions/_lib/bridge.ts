import type { Env } from './types.ts';
import type { LedgerPayload } from './ledger.ts';
import { base64url, utf8 } from './security.ts';
import type { BridgeErrorCode } from '../../src/sync-errors.ts';

class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode) { super(code); this.code = code; }
}
export function bridgeFailureCode(error: unknown): BridgeErrorCode | 'SYNC_FAILED' {
  return error instanceof BridgeError ? error.code : 'SYNC_FAILED';
}

export type BridgeAction = 'ledger.append' | 'ledger.receipt';
export function canonicalLedger(p: LedgerPayload): string { return JSON.stringify({ id: p.id, date: p.date, type: p.type, category: p.category, amountCents: p.amountCents, account: p.account, content: p.content, note: p.note, counterpartyAccount: p.counterpartyAccount, recordedAt: p.recordedAt }); }
export function canonicalMessage(timestamp: number, requestId: string, action: BridgeAction, payload: LedgerPayload): string { return `${timestamp}\n${requestId}\n${action}\n${canonicalLedger(payload)}`; }
export async function signBridge(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(message))));
}
function bridgeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) throw new Error();
    return url.toString();
  } catch { throw new BridgeError('BRIDGE_CONFIG_ERROR'); }
}
export async function callBridge(env: Env, action: BridgeAction, payload: LedgerPayload): Promise<void> {
  const url = bridgeUrl(env.APPS_SCRIPT_WEB_APP_URL);
  if (!env.APPS_SCRIPT_SHARED_SECRET || env.APPS_SCRIPT_SHARED_SECRET.length < 32) throw new BridgeError('BRIDGE_CONFIG_ERROR');
  const timestamp = Date.now(); const requestId = payload.id;
  let signature: string;
  try { signature = await signBridge(env.APPS_SCRIPT_SHARED_SECRET, canonicalMessage(timestamp, requestId, action, payload)); }
  catch { throw new BridgeError('BRIDGE_SIGN_ERROR'); }
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ timestamp, requestId, action, payload, signature }) });
  } catch { throw new BridgeError('BRIDGE_FETCH_ERROR'); }
  if (!response.ok) throw new BridgeError('BRIDGE_HTTP_ERROR');
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new BridgeError('BRIDGE_JSON_ERROR'); }
  // Remote error strings and response context are never forwarded.
  if (!result || typeof result !== 'object' || (result as { ok?: unknown }).ok !== true) throw new BridgeError('BRIDGE_REMOTE_ERROR');
}
