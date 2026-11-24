import { z, type ZodError, type ZodTypeAny } from "zod";

export type AiToolMode = "full" | "code" | "security";
export type AiInteractionMode = "agent" | "ask";

export interface AiToolPropertySpec {
  type?: string;
  description?: string;
  enum?: readonly string[];
  items?: AiToolPropertySpec;
  properties?: Record<string, AiToolPropertySpec>;
  required?: readonly string[];
}

export interface AiToolSpec {
  name: string;
  category?: string;
  description?: string;
  parameters: {
    type?: string;
    properties?: Record<string, AiToolPropertySpec>;
    required?: readonly string[];
  };
}

export interface AiToolContext {
  allowWrites?: boolean;
  toolMode?: AiToolMode | string;
  allowBrowser?: boolean;
  isMcpTool?: (name: string) => boolean;
}

export type AiToolValidationResult =
  | { ok: true; name: string; input: Record<string, unknown> }
  | { ok: false; error: string };

export const AI_WRITE_TOOLS = new Set<string>([
  "write_file",
  "edit_file",
  "create_dir",
  "delete_file",
  "run_command",
  "terminal_session",
  "git",
  "engine_control",
  "wide_custom_tool_run",
  "run_tests",
  "catcher_intercept_decide",
  "catcher_match_replace",
  "intruder_attack",
  "browser_eval",
  "pitcher_env",
  "findings_baseline",
  "debug_control",
]);

export const AI_SECURITY_TOOLS = new Set<string>([
  "transform_data",
  "send_http_request",
  "run_security_scan",
  "check_dependencies",
  "crawl_target",
  "inspect_http_message",
  "manage_catcher",
  "catcher_control",
  "catcher_traffic_query",
  "catcher_intercept_decide",
  "catcher_match_replace",
  "catcher_send_to_repeater",
  "repeater_send",
  "catcher_send_to_intruder",
  "intruder_attack",
  "catcher_ws_send",
  "decision_score",
  "decision_consensus",
  "decision_claim",
  "pitcher_send",
  "pitcher_env",
  "oast_control",
  "oast_poll",
  "vault_list_refs",
  "findings_query",
  "findings_baseline",
]);

export const AI_CODE_ONLY_TOOLS = new Set<string>([
  "write_file",
  "edit_file",
  "create_dir",
  "delete_file",
  "git",
  "get_diagnostics",
  "engine_control",
  "lsp_navigate",
  "debug_control",
  "wide_custom_tool_run",
  "run_tests",
]);

export const AI_EMPTY_STRING_ALLOWED = new Set<string>(["content", "replace"]);

export function aiNormalizeToolMode(mode?: string | null): AiToolMode {
  const normalized = String(mode ?? "full").trim().toLowerCase();
  if (normalized === "code" || normalized === "security" || normalized === "full") {
    return normalized;
  }
  return "full";
}

export function aiIsToolAllowedInContext(
  tool: AiToolSpec | null | undefined,
  opts: AiToolContext = {},
): boolean {
  if (!tool || !tool.name) return false;
  const allowWrites = opts.allowWrites !== false;
  const allowBrowser = opts.allowBrowser !== false;
  if (!allowWrites && AI_WRITE_TOOLS.has(tool.name)) return false;
  if (tool.category === "browser" && !allowBrowser) return false;
  const mode = aiNormalizeToolMode(opts.toolMode);
  if (mode === "code" && AI_SECURITY_TOOLS.has(tool.name)) return false;
  if (mode === "security" && AI_CODE_ONLY_TOOLS.has(tool.name)) return false;
  return true;
}

export function aiFilterToolsFromSpecs(
  specs: readonly AiToolSpec[],
  opts: AiToolContext | boolean = {},
): AiToolSpec[] {
  const normOpts: AiToolContext =
    typeof opts === "boolean"
      ? { allowWrites: opts, toolMode: "full", allowBrowser: true }
      : {
          allowWrites: opts.allowWrites !== false,
          toolMode: aiNormalizeToolMode(opts.toolMode),
          allowBrowser: opts.allowBrowser !== false,
        };
  return specs.filter((tool) => aiIsToolAllowedInContext(tool, normOpts));
}

export const AI_CLAUDE_NATIVE_OVERLAP_TOOLS = new Set<string>([
  "read_file",
  "write_file",
  "edit_file",
  "delete_file",
  "create_dir",
  "list_dir",
  "search",
  "run_command",
]);

export function aiFilterToolsForClaudeMcp(
  specs: readonly AiToolSpec[],
  opts: AiToolContext | boolean = {},
): AiToolSpec[] {
  return aiFilterToolsFromSpecs(specs, opts).filter(
    (tool) => !AI_CLAUDE_NATIVE_OVERLAP_TOOLS.has(tool.name),
  );
}

export function aiBuildZodField(
  propSpec: AiToolPropertySpec | undefined,
  isRequired: boolean,
): ZodTypeAny {
  const spec = propSpec && typeof propSpec === "object" ? propSpec : {};
  let schema: ZodTypeAny;
  if (Array.isArray(spec.enum) && spec.enum.length > 0 && spec.type === "string") {
    schema = z.enum([spec.enum[0], ...spec.enum.slice(1)] as [string, ...string[]]);
  } else if (spec.type === "string") {
    schema = z.string();
  } else if (spec.type === "number" || spec.type === "integer") {
    schema = z.number().finite();
  } else if (spec.type === "boolean") {
    schema = z.boolean();
  } else if (spec.type === "array") {
    const itemSchema = spec.items ? aiBuildZodField(spec.items, true) : z.unknown();
    schema = z.array(itemSchema);
  } else if (spec.type === "object") {
    schema = z.record(z.string(), z.unknown());
  } else {
    schema = z.unknown();
  }
  return isRequired ? schema : schema.optional();
}

export function aiBuildToolZodSchema(paramSpec: AiToolSpec["parameters"]): ZodTypeAny {
  const props = paramSpec && typeof paramSpec.properties === "object" ? paramSpec.properties : {};
  const requiredSet = new Set<string>(Array.isArray(paramSpec?.required) ? paramSpec.required : []);
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, propSpec] of Object.entries(props)) {
    let field = aiBuildZodField(propSpec, requiredSet.has(key));
    if (
      requiredSet.has(key) &&
      propSpec?.type === "string" &&
      !Array.isArray(propSpec.enum) &&
      !AI_EMPTY_STRING_ALLOWED.has(key)
    ) {
      field = field.refine((val: unknown) => typeof val === "string" && val.trim().length > 0, {
        message: `${key} must be a non-empty string`,
      });
    }
    shape[key] = field;
  }
  return z.object(shape).strict();
}

const schemaCache = new WeakMap<readonly AiToolSpec[], Map<string, ZodTypeAny>>();

export function aiGetCompiledToolSchemas(specs: readonly AiToolSpec[]): Map<string, ZodTypeAny> {
  const cached = schemaCache.get(specs);
  if (cached) return cached;
  const map = new Map<string, ZodTypeAny>();
  for (const spec of specs) {
    map.set(spec.name, aiBuildToolZodSchema(spec.parameters));
  }
  schemaCache.set(specs, map);
  return map;
}

export function aiFormatZodSchemaError(
  toolName: string,
  spec: AiToolSpec,
  zodError: ZodError,
): string {
  const issues = Array.isArray(zodError.issues)
    ? zodError.issues.map((iss) => {
        const pathStr = Array.isArray(iss.path) && iss.path.length > 0 ? iss.path.join(".") : "(root)";
        return `${pathStr}: ${iss.message}`;
      })
    : [String(zodError.message || "Invalid tool arguments")];
  const props = spec.parameters.properties ?? {};
  const required = Array.isArray(spec.parameters.required) ? spec.parameters.required : [];
  const expectedFields = Object.entries(props)
    .map(([k, v]) => `${k}${required.includes(k) ? " (required)" : " (optional)"}: ${v?.type || "any"}`)
    .join(", ");
  return `SCHEMA_VALIDATION_ERROR for "${toolName}": ${issues.join("; ")}. Expected strict object with properties: { ${expectedFields} }. Retry using exact schema property names.`;
}

export function aiValidateToolCallFromSpecs(
  specs: readonly AiToolSpec[],
  rawName: unknown,
  rawInput: unknown,
  opts: AiToolContext = {},
): AiToolValidationResult {
  const name = String(rawName ?? "").trim();
  const allowWrites = opts.allowWrites !== false;
  const toolMode = aiNormalizeToolMode(opts.toolMode);
  const allowBrowser = opts.allowBrowser !== false;

  if (!name) {
    return { ok: false, error: "UNKNOWN_TOOL: Empty tool name." };
  }

  if (typeof opts.isMcpTool === "function" && opts.isMcpTool(name)) {
    if (rawInput !== undefined && rawInput !== null && (typeof rawInput !== "object" || Array.isArray(rawInput))) {
      return { ok: false, error: `SCHEMA_VALIDATION_ERROR for "${name}": arguments must be a JSON object.` };
    }
    return {
      ok: true,
      name,
      input: rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {},
    };
  }

  const spec = specs.find((t) => t.name === name);
  if (!spec) {
    const allowedNames = aiFilterToolsFromSpecs(specs, { allowWrites, toolMode, allowBrowser }).map((t) => t.name);
    return {
      ok: false,
      error: `UNKNOWN_TOOL: "${name}" does not exist. Enabled tools (${toolMode}): ${allowedNames.join(", ")}.`,
    };
  }

  if (!allowWrites && AI_WRITE_TOOLS.has(name)) {
    return {
      ok: false,
      error: `PERMISSION_DENIED: Tool "${name}" is disabled in read-only Ask mode.`,
    };
  }

  if (!aiIsToolAllowedInContext(spec, { allowWrites, toolMode, allowBrowser })) {
    const reason =
      spec.category === "browser" && !allowBrowser
        ? `Tool "${name}" requires Browser mode to be enabled, but the Browser toggle is currently turned OFF by the user.`
        : `Tool "${name}" is disabled in "${toolMode}" mode.`;
    return {
      ok: false,
      error: `TOOL_DISABLED_IN_MODE: ${reason}`,
    };
  }

  if (rawInput === null || rawInput === undefined || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    return {
      ok: false,
      error: `SCHEMA_VALIDATION_ERROR for "${name}": Tool arguments must be a strict JSON object.`,
    };
  }

  const schemas = aiGetCompiledToolSchemas(specs);
  const schema = schemas.get(name);
  if (schema) {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: aiFormatZodSchemaError(name, spec, parsed.error),
      };
    }
    return { ok: true, name, input: parsed.data as Record<string, unknown> };
  }

  return { ok: true, name, input: rawInput as Record<string, unknown> };
}
