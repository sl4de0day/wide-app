import { Bug } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useTelemetry } from "@/stores/telemetry";

export function CrashReportDialog() {
  const t = useT();
  const pendingCrash = useTelemetry((state) => state.pendingCrash);
  const isSending = useTelemetry((state) => state.isSending);
  const sendError = useTelemetry((state) => state.sendError);
  const submitPending = useTelemetry((state) => state.submitPending);
  const discardPending = useTelemetry((state) => state.discardPending);

  if (!pendingCrash) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-canvas/60 p-4 backdrop-blur-sm">
      <div className="wide-enter-zoom flex max-w-lg flex-col gap-4 rounded-xl border border-line bg-raised p-6 shadow-2xl">
        <div className="flex items-center gap-3 text-status-error">
          <Bug className="size-6" strokeWidth={1.5} />
          <h2 className="text-[14px] font-semibold text-fg-bright">
            {t("A crash was detected from the previous session")}
          </h2>
        </div>

        <p className="text-[12px] leading-relaxed text-fg-dim">
          {t("It appears {app} encountered an unexpected error and closed. You can help improve stability by submitting this anonymous report.", { app: "Wide" })}
        </p>

        <div className="max-h-40 overflow-y-auto rounded-md bg-canvas p-3 text-[11px] font-mono text-fg-faint">
          <div className="mb-1 font-semibold text-fg">{t("Type: {kind}", { kind: pendingCrash.kind })}</div>
          <div className="whitespace-pre-wrap">{pendingCrash.detail}</div>
        </div>

        {sendError ? (
          <div className="rounded-md bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
            {sendError}
          </div>
        ) : null}

        <div className="mt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isSending}
            onClick={() => void discardPending()}
            className="rounded-md px-3 py-1.5 text-[12px] text-fg-dim transition-colors duration-100 hover:text-fg disabled:opacity-50"
          >
            {t("Dismiss")}
          </button>
          <button
            type="button"
            disabled={isSending}
            onClick={() => void submitPending()}
            className="rounded-md bg-accent px-4 py-1.5 text-[12px] font-medium text-white transition-colors duration-100 hover:bg-accent-hover disabled:opacity-50"
          >
            {isSending ? t("Sending...") : t("Send Report")}
          </button>
        </div>
      </div>
    </div>
  );
}
