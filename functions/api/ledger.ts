import { callBridge } from '../_lib/bridge.ts';
import { validateLedgerPayload } from '../_lib/ledger.ts';
import { json, sameOrigin, sessionFor } from '../_lib/security.ts';
import type { PagesHandler } from '../_lib/types.ts';

const YEAR = 365 * 24 * 3600;
export const onRequestPost: PagesHandler = async ({ request, env }) => {
  if (!sameOrigin(request)) return json({ ok: false, error: 'ORIGIN_REJECTED' }, 403);
  if (!await sessionFor(request, env)) return json({ ok: false, error: 'UNAUTHENTICATED' }, 401);
  let payload; try { payload = validateLedgerPayload(await request.json()); } catch { return json({ ok: false, error: 'INVALID_PAYLOAD' }, 400); }
  const key = `ledger:${payload.id}`; const prior = await env.DUANOS_KV.get(key);
  if (prior === 'complete') return json({ ok: true, duplicate: true, receiptSent: true });
  if (prior === 'sheet_written') {
    try { await callBridge(env, 'ledger.receipt', payload); await env.DUANOS_KV.put(key, 'complete', { expirationTtl: YEAR }); return json({ ok: true, duplicate: true, receiptSent: true }); }
    catch { return json({ ok: true, duplicate: true, receiptSent: false, error: 'RECEIPT_FAILED' }, 202); }
  }
  if (prior === 'processing') return json({ ok: false, error: 'IN_PROGRESS' }, 409);
  await env.DUANOS_KV.put(key, 'processing', { expirationTtl: 60 });
  try {
    await callBridge(env, 'ledger.append', payload); await env.DUANOS_KV.put(key, 'sheet_written', { expirationTtl: YEAR });
    try { await callBridge(env, 'ledger.receipt', payload); await env.DUANOS_KV.put(key, 'complete', { expirationTtl: YEAR }); return json({ ok: true, duplicate: false, receiptSent: true }); }
    catch { return json({ ok: true, duplicate: false, receiptSent: false, error: 'RECEIPT_FAILED' }, 202); }
  } catch { await env.DUANOS_KV.delete(key); return json({ ok: false, error: 'SYNC_FAILED' }, 502); }
};
