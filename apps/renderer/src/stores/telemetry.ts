import { create } from "zustand";
import { bridge } from "@/lib/bridge";

export interface CrashReport {
  kind: string;
  detail: string;
  os: string;
  version: string;
  timestamp: number;
}

interface TelemetryState {
  pendingCrash: CrashReport | null;
  crashPath: string | null;
  isSending: boolean;
  sendError: string | null;

  checkPending: () => Promise<void>;
  submitPending: () => Promise<void>;
  discardPending: () => Promise<void>;
}

export const useTelemetry = create<TelemetryState>((set, get) => ({
  pendingCrash: null,
  crashPath: null,
  isSending: false,
  sendError: null,

  checkPending: async () => {
    try {
      const res = await bridge.toolsList("");
      if (!res || !res.dirs?.user) return;
      const userDir = res.dirs.user.replace(/[/\\]tools[/\\]?$/, "");
      let path = `${userDir}/pending_crash.json`;
      let file = await bridge.readFile(path);
      if (!file || file.error || !file.content) {
        path = `${res.dirs.user}/pending_crash.json`;
        file = await bridge.readFile(path);
      }
      if (file && file.content && !file.error) {
        const report = JSON.parse(file.content) as CrashReport;
        set({ pendingCrash: report, crashPath: path, sendError: null });
      }
    } catch {
      return;
    }
  },

  submitPending: async () => {
    const { pendingCrash, crashPath } = get();
    if (!pendingCrash) return;

    set({ isSending: true, sendError: null });
    let sent = false;
    try {
      const supabaseUrl = "https://kunntjfmlsjlvdunqkjl.supabase.co/rest/v1/crash_reports";
      const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1bm50amZtbHNqbHZkdW5xa2psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MTg2NTQsImV4cCI6MjEwNTQ5NDY1NH0.EoJUVVlah-ugiuxe4O7lF0hjnrmkDCNtTGE0bW_TS0U";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await fetch(supabaseUrl, {
          method: "POST",
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify(pendingCrash),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        sent = true;
      } else {
        const msg = `${res.status} ${res.statusText}`.trim() || "Upload failed";
        console.error("[telemetry] Failed to send crash report:", msg);
        set({ sendError: msg });
      }
    } catch (e) {
      console.error("[telemetry] Failed to send crash report:", e);
      set({ sendError: e instanceof Error ? e.message : String(e) });
    } finally {
      if (sent) {
        if (crashPath) {
          await bridge.trash(crashPath).catch(() => {});
        }
        set({ isSending: false, pendingCrash: null, crashPath: null, sendError: null });
      } else {
        set({ isSending: false });
      }
    }
  },

  discardPending: async () => {
    const { crashPath } = get();
    if (crashPath) {
      await bridge.trash(crashPath).catch(() => {});
    }
    set({ pendingCrash: null, crashPath: null, sendError: null });
  }
}));
