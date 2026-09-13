const LEDGER_SHEET = '记账流水';
const ALLOWED_ACTIONS = ['ledger.append', 'ledger.receipt'];
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function canonicalPayload_(p) {
  return JSON.stringify({ id: p.id, date: p.date, type: p.type, category: p.category, amountCents: p.amountCents, account: p.account, content: p.content, note: p.note, counterpartyAccount: p.counterpartyAccount, recordedAt: p.recordedAt });
}

function canonicalMessage_(request) {
  return request.timestamp + '\n' + request.requestId + '\n' + request.action + '\n' + canonicalPayload_(request.payload);
}

function signature_(secret, message) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(message, secret)).replace(/=+$/, '');
}

function constantTimeEqual_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  var difference = 0;
  for (var i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function validPayload_(p, requestId) {
  if (!p || p.id !== requestId || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || ['支出', '收入'].indexOf(p.type) < 0) return false;
  var parts = p.date.split('-').map(Number); var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.toISOString().slice(0, 10) !== p.date) return false;
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0 || p.amountCents > 10000000000) return false;
  var strings = ['category', 'account', 'content', 'note', 'counterpartyAccount', 'recordedAt'];
  for (var i = 0; i < strings.length; i++) if (typeof p[strings[i]] !== 'string' || p[strings[i]].length > 4000) return false;
  return p.account.trim().length > 0 && p.content.trim().length > 0 && !isNaN(Date.parse(p.recordedAt));
}

function ledgerRow_(p) {
  return [p.date, p.type, p.category, (p.amountCents / 100).toFixed(2), p.account.trim(), p.content.trim(), p.note.trim(), p.counterpartyAccount.trim(), Utilities.formatDate(new Date(p.recordedAt), 'Asia/Shanghai', 'yyyy-MM-dd HH:mm:ss')];
}

function doPost(e) {
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var properties = PropertiesService.getScriptProperties();
    var secret = properties.getProperty('DUANOS_BRIDGE_SECRET');
    if (!secret || secret.length < 32) throw new Error('NOT_CONFIGURED');
    if (!Number.isFinite(request.timestamp) || Math.abs(Date.now() - request.timestamp) > MAX_CLOCK_SKEW_MS) throw new Error('STALE_REQUEST');
    if (ALLOWED_ACTIONS.indexOf(request.action) < 0 || !validPayload_(request.payload, request.requestId)) throw new Error('INVALID_REQUEST');
    if (!constantTimeEqual_(signature_(secret, canonicalMessage_(request)), request.signature)) throw new Error('INVALID_SIGNATURE');
    var lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      var stateKey = 'ledger:' + request.requestId;
      var state = properties.getProperty(stateKey);
      if (request.action === 'ledger.append') {
        if (state === 'sheet_written' || state === 'complete') return output_({ ok: true, duplicate: true });
        var spreadsheetId = properties.getProperty('SPREADSHEET_ID');
        if (!spreadsheetId) throw new Error('NOT_CONFIGURED');
        var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(LEDGER_SHEET);
        if (!sheet) throw new Error('LEDGER_SHEET_NOT_FOUND');
        sheet.appendRow(ledgerRow_(request.payload));
        properties.setProperty(stateKey, 'sheet_written');
        return output_({ ok: true, duplicate: false });
      }
      if (state === 'complete') return output_({ ok: true, duplicate: true });
      if (state !== 'sheet_written') throw new Error('SHEET_NOT_WRITTEN');
      var receiptEmail = properties.getProperty('RECEIPT_EMAIL');
      if (!receiptEmail) throw new Error('NOT_CONFIGURED');
      MailApp.sendEmail(receiptEmail, 'DuanOS 记账成功回执', '已写入记账流水：' + request.payload.date + '｜' + request.payload.type + '｜' + (request.payload.amountCents / 100).toFixed(2) + ' 元｜' + request.payload.content);
      properties.setProperty(stateKey, 'complete');
      return output_({ ok: true, duplicate: false });
    } finally { lock.releaseLock(); }
  } catch (error) {
    console.error('Bridge request failed: %s', error && error.message ? error.message : 'UNKNOWN');
    return output_({ ok: false, error: 'BRIDGE_REQUEST_FAILED' });
  }
}
