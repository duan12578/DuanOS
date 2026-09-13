import type { Env, GoogleTokens, StoredSession } from './types.ts';
import { base64url, encryptJson } from './security.ts';
import type { LedgerPayload } from './ledger.ts';
import { ledgerRow, sheetRange } from './ledger.ts';

async function googleJson<T>(url: string, init: RequestInit, accessToken?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(`GOOGLE_${response.status}`);
  return response.json() as Promise<T>;
}

export async function exchangeCode(env: Env, code: string, verifier: string): Promise<GoogleTokens> {
  return googleJson('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: verifier }) });
}

export async function userEmail(accessToken: string): Promise<string> {
  const info = await googleJson<{ email: string; email_verified: boolean }>('https://openidconnect.googleapis.com/v1/userinfo', { method: 'GET' }, accessToken);
  if (!info.email_verified) throw new Error('EMAIL_NOT_VERIFIED');
  return info.email.toLowerCase();
}

export async function refreshSession(env: Env, sessionId: string, session: StoredSession): Promise<StoredSession> {
  if (session.expiresAt > Date.now() + 60_000) return session;
  if (!session.refreshToken) throw new Error('REAUTH_REQUIRED');
  const tokens = await googleJson<GoogleTokens>('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: session.refreshToken, grant_type: 'refresh_token' }) });
  const next = { ...session, accessToken: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
  await env.DUANOS_KV.put(`session:${sessionId}`, await encryptJson(next, env.SESSION_ENCRYPTION_KEY), { expirationTtl: 30 * 24 * 3600 });
  return next;
}

export async function locateLedgerSpreadsheet(env: Env, accessToken: string): Promise<string> {
  const spreadsheetId = env.GOOGLE_SPREADSHEET_ID.trim();
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');
  const meta = await googleJson<{ sheets: Array<{ properties: { title: string } }> }>(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`, { method: 'GET' }, accessToken);
  if (!meta.sheets.some(sheet => sheet.properties.title === '记账流水')) throw new Error('LEDGER_SHEET_NOT_FOUND');
  return spreadsheetId;
}

export async function appendLedger(accessToken: string, spreadsheetId: string, payload: LedgerPayload): Promise<void> {
  const range = encodeURIComponent(sheetRange('记账流水'));
  await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [ledgerRow(payload)] }) }, accessToken);
}

export async function sendReceipt(accessToken: string, email: string, payload: LedgerPayload): Promise<void> {
  const subject = `DuanOS 记账成功：${payload.type} ${(payload.amountCents / 100).toFixed(2)} 元`;
  const body = `日期：${payload.date}\n类型：${payload.type}\n金额：${(payload.amountCents / 100).toFixed(2)} 元\n账户：${payload.account}\n内容：${payload.content}\n记录 ID：${payload.id}`;
  const subject64 = btoa(String.fromCharCode(...new TextEncoder().encode(subject)));
  const message = `From: ${email}\r\nTo: ${email}\r\nSubject: =?UTF-8?B?${subject64}?=\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;
  const raw = base64url(new TextEncoder().encode(message));
  await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) }, accessToken);
}
