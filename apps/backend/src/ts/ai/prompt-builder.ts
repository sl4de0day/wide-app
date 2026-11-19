import type { AiToolMode } from "./tool-registry";

export interface AiPromptRule {
  id?: string;
  severity?: string;
  title?: string;
  instruction?: string;
  message?: string;
  pattern?: string;
}

export interface AiPromptFilterContext {
  allowWrites: boolean;
  toolMode: AiToolMode | string;
  allowBrowser: boolean;
  isExternalCli?: boolean;
}

export function aiBuildWideCapabilityPlaybook(ctx: AiPromptFilterContext): string {
  const mode = String(ctx.toolMode || "full").toLowerCase();
  const lines: string[] = [
    "## Wide Ecosystem Capability Playbook",
    `- Document & .docx Reader: use ${ctx.isExternalCli ? "Wide MCP tool 'read_document'" : "'read_document' or 'read_file'"} to extract clean paragraphs from .docx Word files via Wide's zero-dependency ZIP/XML reader instead of binary file readers.`,
  ];

  if (ctx.allowBrowser) {
    lines.push(
      "- Live Browser, FastRead & Clean Article Extraction: pass fastRead=true to 'browser_open' or 'browser_navigate' to abort heavy images, fonts, media, stylesheets, and analytics trackers; call 'browser_extract' with mode='article' or mode='clean_text' to strip navigation/footer boilerplate, or mode='js_endpoints' | 'secrets' | 'state_graph' for SPA/API reconnaissance.",
    );
  }

  if (mode !== "code") {
    lines.push(
      "- Target Spider & Recon Core ('crawl_target'): crawl web targets with scope/SSRF enforcement (allowPrivate), PathTrie high-cardinality route collapsing, SimHash64 near-duplicate filtering, offline Wappalyzer technology fingerprinting, passive security header/JWT/entropy-secret auditing, and StateGraph transition mapping.",
      "- Deep HTTP Inspection, RFC 9112 Smuggling & Lexical SQLi/XSS ('inspect_http_message' & 'manage_catcher'): inspect requests, responses, or raw HTTP/1.x wire payloads for RFC 9112 CL+TE smuggling and response poisoning, %uXXXX/UTF-8 evasion signals, lexical SQLi and HTML5 multi-context XSS tokenizers, ReDoS-safe Thompson NFA rules, and learning=true dated 'except ...' exception draft generation.",
      "- Resilient HTTP & Active Probing ('send_http_request', 'pitcher_send', 'repeater_send', 'intruder_attack'): enforce hop-by-hop redirect SSRF and user:pass@ credential blocks (allowPrivate=false), exponential jitter backoff on transient 429/5xx errors (retries=1..4), per-host circuit breaker protection (useBreaker=true), and browser header profiles (tlsProfile='chrome' | 'firefox' | 'safari').",
    );
  }

  if (mode !== "security") {
    lines.push(
      "- Compiler, Database & Decision Engines: use 'get_diagnostics' and 'lsp_navigate' for TypeScript/LSP symbol intelligence, 'db_*' tools for read-only/audited SQL and Redis queries, and 'decision_*' for formal consensus or multi-criteria scoring.",
    );
  }

  return lines.join("\n");
}

export function aiFormatAgentInstructions(rules: readonly AiPromptRule[] | undefined | null): string {
  const list = Array.isArray(rules) ? rules : [];
  const lines: string[] = [];
  for (const r of list) {
    const text = String(r?.instruction ?? r?.message ?? "").trim();
    if (text) {
      lines.push(`- ${text}`);
    }
  }
  return lines.join("\n");
}

export function aiFilterGuardrailsByContext(
  rules: readonly AiPromptRule[] | undefined | null,
  { allowWrites, toolMode, allowBrowser }: AiPromptFilterContext,
): string {
  const list = Array.isArray(rules) ? rules : [];
  const filtered: AiPromptRule[] = [];
  for (const r of list) {
    if (!r) continue;
    if (r.id === "wide/ai-direct-file-edits" && !allowWrites) {
      continue;
    }
    if (r.id === "wide/ai-native-tool-priority") {
      const parts: string[] = [];
      if (toolMode !== "security") {
        parts.push("read_file, read_document (.docx), edit_file, search, lsp_navigate, get_diagnostics, and run_tests for code and document work");
      } else {
        parts.push("read_file and read_document (.docx) for workspace inspection");
      }
      if (allowBrowser) {
        parts.push("browser_* tools (with fastRead=true and browser_extract mode='article' | 'clean_text' | 'js_endpoints' | 'secrets' | 'state_graph') for interactive browsing");
      }
      if (toolMode !== "code") {
        parts.push("crawl_target for spidering and tech fingerprinting, inspect_http_message and catcher_* for RFC 9112 smuggling and lexical SQLi/XSS inspection, repeater_send/intruder_attack for fuzzing, send_http_request/pitcher_* for resilient HTTP requests, run_security_scan for static analysis, and transform_data for encoding or hashing");
      }
      filtered.push({
        ...r,
        instruction: `Always prefer native IDE tools over ad-hoc shell scripts: use ${parts.join(", ")}. Never tell the user you cannot interact with Wide UI controls.`,
      });
      continue;
    }
    filtered.push(r);
  }
  return aiFormatAgentInstructions(filtered);
}
