import * as nodePath from "node:path";

export interface CachedLspDiagnostic {
  line?: number;
  col?: number;
  from?: number;
  to?: number;
  severity: string;
  message: string;
  source?: string;
}

export class LspDiagnosticsCache {
  private readonly store = new Map<string, CachedLspDiagnostic[]>();

  set(filePath: string, items: CachedLspDiagnostic[]): void {
    const key = nodePath.resolve(String(filePath || ""));
    if (!key) return;
    if (items.length === 0) this.store.delete(key);
    else this.store.set(key, items);
  }

  get(filePath: string): CachedLspDiagnostic[] {
    const key = nodePath.resolve(String(filePath || ""));
    return this.store.get(key) ?? [];
  }

  clear(filePath: string): void {
    const key = nodePath.resolve(String(filePath || ""));
    this.store.delete(key);
  }
}
