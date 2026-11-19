export interface RecoverableErrorOptions {
  level?: "warn" | "error";
  ignoreCodes?: readonly string[];
  surfaceToUi?: boolean;
  onFault?: (scope: string, detail: string) => void;
  logger?: Pick<Console, "warn" | "error">;
}

export function extractErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" || typeof code === "number" ? String(code) : "";
  }
  return "";
}

export function formatErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return String(error ?? "Unknown error");
}

export function reportRecoverableError(
  scope: string,
  action: string,
  error: unknown,
  options: RecoverableErrorOptions = {},
): void {
  const errCode = extractErrorCode(error);
  if (Array.isArray(options.ignoreCodes) && errCode && options.ignoreCodes.includes(errCode)) {
    return;
  }
  const message = formatErrorMessage(error);
  const sink = options.logger ?? console;
  if (options.level === "error") {
    sink.error(`[${scope}] ${action}: ${message}`);
  } else {
    sink.warn(`[${scope}] ${action}: ${message}`);
  }
  if (options.surfaceToUi && typeof options.onFault === "function") {
    options.onFault(scope, `${action}: ${message}`);
  }
}
