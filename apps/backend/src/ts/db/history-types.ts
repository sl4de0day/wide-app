export interface DbQueryHistoryEntry {
  id?: string;
  connectionId: string;
  sql: string;
  durationMs: number;
  rowCount: number;
  error?: string;
  ranAt: number;
}

export function prependDbHistory(
  existing: readonly DbQueryHistoryEntry[],
  item: DbQueryHistoryEntry,
  maxItems = 50,
): DbQueryHistoryEntry[] {
  return [item, ...existing.slice(0, Math.max(0, maxItems - 1))];
}
