import { json, sessionFor } from '../_lib/security.ts';
import { validateLedgerPayload } from '../_lib/ledger.ts';
import { appendLedger, locateLedgerSpreadsheet, refreshSession, sendReceipt } from '../_lib/google.ts';
import type { PagesHandler } from '../_lib/types.ts';

export const onRequestPost: PagesHandler = async ({ request, env }) => {
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ ok: false, error: 'ORIGIN_REJECTED' }, 403);
  const auth = await sessionFor(request, env);
  if (!auth) return json({ ok: false, error: 'UNAUTHENTICATED' }, 401);
  let payload;
  try { payload = validateLedgerPayload(await request.json()); }
  catch { return json({ ok: false, error: 'INVALID_PAYLOAD' }, 400); }
  const key = `ledger:${payload.id}`;
  const prior = await env.DUANOS_KV.get(key);
  if (prior === 'complete') return json({ ok: true, duplicate: true, receiptSent: true });
  if (prior === 'sheet_written') {
    try {
      const session = await refreshSession(env, auth.id, auth.value);
      await sendReceipt(session.accessToken, session.email, payload);
      await env.DUANOS_KV.put(key, 'complete', { expirationTtl: 365 * 24 * 3600 });
      return json({ ok: true, duplicate: true, receiptSent: true });
    } catch { return json({ ok: true, duplicate: true, receiptSent: false, error: 'RECEIPT_FAILED' }, 202); }
  }
  if (prior === 'processing') return json({ ok: false, error: 'IN_PROGRESS' }, 409);
  await env.DUANOS_KV.put(key, 'processing', { expirationTtl: 60 });
  try {
    const session = await refreshSession(env, auth.id, auth.value);
    const spreadsheetId = await locateLedgerSpreadsheet(env, session.accessToken);
    await appendLedger(session.accessToken, spreadsheetId, payload);
    await env.DUANOS_KV.put(key, 'sheet_written', { expirationTtl: 365 * 24 * 3600 });
    try {
      await sendReceipt(session.accessToken, session.email, payload);
      await env.DUANOS_KV.put(key, 'complete', { expirationTtl: 365 * 24 * 3600 });
      return json({ ok: true, duplicate: false, receiptSent: true });
    } catch { return json({ ok: true, duplicate: false, receiptSent: false, error: 'RECEIPT_FAILED' }, 202); }
  } catch {
    await env.DUANOS_KV.delete(key);
    return json({ ok: false, error: 'SYNC_FAILED' }, 502);
  }
};
