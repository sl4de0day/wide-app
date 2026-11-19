export interface RawSecRule {
  id?: string;
  category?: string;
  [key: string]: unknown;
}

export function filterAiSecurityRules(raw: unknown): RawSecRule[] {
  const list = Array.isArray(raw)
    ? (raw as RawSecRule[])
    : raw && typeof raw === "object" && Array.isArray((raw as { rules?: unknown }).rules)
      ? ((raw as { rules: RawSecRule[] }).rules)
      : [];
  return list.filter((r) => Boolean(r) && (r.category === "AI_SECURITY" || String(r.id ?? "").includes("ai-")));
}
