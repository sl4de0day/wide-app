export interface AiVerificationDiagnostic {
  source: string;
  line: number;
  col: number;
  severity: string;
  code: string;
  message: string;
}

export interface AiOffsetPosition {
  line: number;
  col: number;
}

export function aiOffsetToPosition(content: unknown, offset: number): AiOffsetPosition {
  const text = String(content ?? "");
  const limit = Math.max(0, Math.min(text.length, Number(offset) || 0));
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < limit; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lastNl = i;
    }
  }
  return { line, col: limit - lastNl };
}

export function aiFormatVerificationMessage(
  resolvedPath: string,
  relPath: string,
  items: readonly AiVerificationDiagnostic[],
): { errors: AiVerificationDiagnostic[]; warnings: AiVerificationDiagnostic[]; note: string } {
  const errors = items.filter((it) => String(it.severity).toLowerCase() === "error");
  const warnings = items.filter((it) => String(it.severity).toLowerCase() === "warning");

  if (errors.length === 0 && warnings.length === 0) {
    return {
      errors,
      warnings,
      note: /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(resolvedPath)
        ? "\nAuto-verification: TypeScript and ESLint passed with 0 errors."
        : "",
    };
  }

  if (errors.length === 0) {
    const warnPreview = warnings
      .slice(0, 5)
      .map((w) => `- [Line ${w.line}, Col ${w.col}] [${w.source}]: ${w.message}`)
      .join("\n");
    return {
      errors,
      warnings,
      note: `\nAuto-verification: 0 error(s), ${warnings.length} warning(s) in ${relPath}:\n${warnPreview}`,
    };
  }

  const errPreview = errors
    .slice(0, 10)
    .map((e) => `- [Line ${e.line}, Col ${e.col}] [ERROR${e.code ? ` ${e.code}` : ""} - ${e.source}]: ${e.message}`)
    .join("\n");
  return {
    errors,
    warnings,
    note: `\n[AUTO-VERIFICATION FAILED: ${errors.length} error(s) detected in ${relPath}]\n${errPreview}\nFix these diagnostics before finishing your response.`,
  };
}
