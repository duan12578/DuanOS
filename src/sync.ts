import type { Entry, SyncState } from './domain';

export function updateSync(entries: Entry[], id: string, syncState: SyncState, syncError?: string): Entry[] {
  return entries.map(entry => entry.id === id ? { ...entry, syncState, syncError } : entry);
}

export function pendingSyncCount(entries: Entry[]): number {
  return entries.filter(entry => entry.kind === 'ledger' && entry.syncState !== 'synced').length;
}
