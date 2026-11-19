export interface AiLocalToolCall {
  name: string;
  input: Record<string, unknown>;
}

export function aiEscapeControlCharsInJsonStrings(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === "\n") {
        out += "\\n";
      } else if (ch === "\r") {
        out += "\\r";
      } else if (ch === "\t") {
        out += "\\t";
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

export function aiParseLenientJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw
    .trim()
    .replace(/^```(?:json|tool_call)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    void 0;
  }
  try {
    return JSON.parse(aiEscapeControlCharsInJsonStrings(trimmed));
  } catch {
    void 0;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sub = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(sub);
    } catch {
      try {
        return JSON.parse(aiEscapeControlCharsInJsonStrings(sub));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function aiParseXmlFunctionBlock(funcName: string, inner: string): AiLocalToolCall | null {
  const params: Record<string, unknown> = {};
  const paramRegex = /<parameter=([a-zA-Z0-9_.-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/gi;
  let match: RegExpExecArray | null;
  let foundParam = false;
  while ((match = paramRegex.exec(inner)) !== null) {
    foundParam = true;
    const key = match[1].trim();
    let val = match[2];
    if (val.startsWith("\n")) val = val.slice(1);
    if (val.endsWith("\n")) val = val.slice(0, -1);
    params[key] = val;
  }
  const cleanName = String(funcName || "").trim();
  if (foundParam) {
    return { name: cleanName, input: params };
  }
  const parsedJson = aiParseLenientJson(inner);
  if (parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)) {
    const record = parsedJson as Record<string, unknown>;
    const args = record.arguments ?? record.input ?? record.parameters ?? record;
    const resolved = typeof args === "string" ? aiParseLenientJson(args) : args;
    return {
      name: cleanName,
      input:
        resolved && typeof resolved === "object" && !Array.isArray(resolved)
          ? (resolved as Record<string, unknown>)
          : {},
    };
  }
  return null;
}

export function aiConvertParsedObjectToCall(obj: unknown): AiLocalToolCall | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const record = obj as Record<string, unknown>;
  const fnObj =
    record.function && typeof record.function === "object" && !Array.isArray(record.function)
      ? (record.function as Record<string, unknown>)
      : null;
  const rawName = record.name ?? fnObj?.name;
  if (typeof rawName !== "string" || !rawName.trim()) return null;
  let rawArgs = record.arguments ?? record.input ?? record.parameters ?? fnObj?.arguments;
  if (typeof rawArgs === "string") {
    rawArgs = aiParseLenientJson(rawArgs) ?? {};
  }
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return { name: rawName.trim(), input: {} };
  }
  return { name: rawName.trim(), input: rawArgs as Record<string, unknown> };
}

export function aiExtractTextToolCalls(
  text: unknown,
  knownToolNames?: ReadonlySet<string>,
): AiLocalToolCall[] {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  const results: AiLocalToolCall[] = [];

  const toolCallRegex = /<tool_call\b[^>]*>([\s\S]*?)(?:<\/tool_call>|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = toolCallRegex.exec(raw)) !== null) {
    const body = match[1].trim();
    if (!body) continue;
    const fnMatch = /<function=([a-zA-Z0-9_.-]+)>([\s\S]*?)(?:<\/function>|$)/i.exec(body);
    if (fnMatch) {
      const call = aiParseXmlFunctionBlock(fnMatch[1], fnMatch[2]);
      if (call && call.name) results.push(call);
      continue;
    }
    const parsed = aiParseLenientJson(body);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const call = aiConvertParsedObjectToCall(item);
        if (call && call.name) results.push(call);
      }
    } else if (parsed) {
      const call = aiConvertParsedObjectToCall(parsed);
      if (call && call.name) results.push(call);
    }
  }

  if (results.length > 0) return results;

  const standaloneFnRegex = /<function=([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/function>/gi;
  while ((match = standaloneFnRegex.exec(raw)) !== null) {
    const call = aiParseXmlFunctionBlock(match[1], match[2]);
    if (call && call.name) results.push(call);
  }
  if (results.length > 0) return results;

  const fenceRegex = /```(?:tool_call|json)?\s*\n([\s\S]*?)```/gi;
  while ((match = fenceRegex.exec(raw)) !== null) {
    const body = match[1].trim();
    if (!body.startsWith("{")) continue;
    const parsed = aiParseLenientJson(body);
    if (!parsed) continue;
    const call = aiConvertParsedObjectToCall(parsed);
    if (call && (!knownToolNames || knownToolNames.has(call.name.toLowerCase()))) {
      results.push(call);
    }
  }

  return results;
}
