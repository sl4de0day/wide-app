export interface MacroExtractRule {
  name: string;
  source?: "header" | "body" | string;
  pattern: string;
}

export function extractMacroVars(
  rules: readonly MacroExtractRule[],
  headers: readonly [string, string][],
  body: string,
  vars: Map<string, string>,
  onError?: (rule: MacroExtractRule, error: unknown) => void,
): void {
  for (const rule of rules) {
    const source =
      rule.source === "header" ? headers.map(([name, value]) => `${name}: ${value}`).join("\n") : body;
    try {
      const match = new RegExp(rule.pattern).exec(source);
      if (match) vars.set(rule.name, match[1] ?? match[0]);
    } catch (error) {
      if (typeof onError === "function") onError(rule, error);
    }
  }
}
