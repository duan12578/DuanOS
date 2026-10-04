// Only these fixed codes may cross the bridge/API/UI error boundaries.
export const bridgeErrorCodes = [
  'BRIDGE_CONFIG_ERROR', 'BRIDGE_SIGN_ERROR', 'BRIDGE_FETCH_ERROR',
  'BRIDGE_HTTP_ERROR', 'BRIDGE_JSON_ERROR', 'BRIDGE_REMOTE_ERROR',
] as const;
export type BridgeErrorCode = typeof bridgeErrorCodes[number];

const syncErrorCodes: readonly string[] = [
  ...bridgeErrorCodes, 'SYNC_FAILED', 'ORIGIN_REJECTED', 'UNAUTHENTICATED',
  'INVALID_PAYLOAD', 'INVALID_LEDGER_ENTRY', 'IN_PROGRESS',
];
export function safeSyncErrorCode(value: unknown): string {
  return typeof value === 'string' && syncErrorCodes.includes(value) ? value : 'SYNC_FAILED';
}

export const receiptPendingMessage = '表格已同步，回执邮件待重试';
export function syncErrorLabel(value: unknown): string {
  return value === receiptPendingMessage ? `同步失败 · ${receiptPendingMessage}` : `同步失败（${safeSyncErrorCode(value)}）`;
}
