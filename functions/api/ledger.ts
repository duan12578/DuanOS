import { bridgeFailureCode, callBridge } from '../_lib/bridge.ts';
import { validateLedgerPayload } from '../_lib/ledger.ts';
import { json, sameOrigin, sessionFor } from '../_lib/security.ts';
import type { PagesHandler } from '../_lib/types.ts';

const YEAR = 365 * 24 * 3600;
export const onRequestPost: PagesHandler = async ({ request, env }) => {
  if (!sameOrigin(request)) return json({ ok: false, error: 'ORIGIN_REJECTED' }, 403);
  let session;
  try { session = await sessionFor(request, env); }
  catch { return json({ ok: false, error: 'LEDGER_SESSION_ERROR' }, 503); }
  if (!session) return json({ ok: false, error: 'UNAUTHENTICATED' }, 401);
  let payload; try { payload = validateLedgerPayload(await request.json()); } catch { return json({ ok: false, error: 'INVALID_PAYLOAD' }, 400); }
  const key = `ledger:${payload.id}`;
  let prior;
  try { prior = await env.DUANOS_KV.get(key); }
  catch { return json({ ok: false, error: 'LEDGER_STATE_READ_ERROR' }, 503); }
  if (prior === 'complete') return json({ ok: true, duplicate: true, receiptSent: true });
  // Honor short-lived markers from older Functions until their original TTL expires.
  if (prior === 'processing') return json({ ok: false, error: 'IN_PROGRESS' }, 409);
  const duplicate = prior === 'sheet_written';
  if (!duplicate) {
    try { await callBridge(env, 'ledger.append', payload); }
    catch (failure) { return json({ ok: false, error: bridgeFailureCode(failure) }, 502); }
  }
  // Apps Script's lock + persistent state protect append/mail when this KV cache is
  // absent or stale. Write one terminal state per request, avoiding KV's per-key
  // write limit; a cache error must not override a confirmed remote outcome.
  let receiptSent = true;
  try { await callBridge(env, 'ledger.receipt', payload); }
  catch { receiptSent = false; }
  if (receiptSent || !duplicate) {
    try { await env.DUANOS_KV.put(key, receiptSent ? 'complete' : 'sheet_written', { expirationTtl: YEAR }); }
    catch { console.error('LEDGER_STATE_WRITE_ERROR'); }
  }
  return receiptSent
    ? json({ ok: true, duplicate, receiptSent: true })
    : json({ ok: true, duplicate, receiptSent: false, error: 'RECEIPT_FAILED' }, 202);
};
