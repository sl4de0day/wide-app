let aiSdkVendorCache = null;

function aiLoadSdkVendor() {
  if (aiSdkVendorCache) return aiSdkVendorCache;
  const candidates = [
    node_path.join(__dirname, "ai-vendor.cjs"),
    node_path.resolve(__dirname, "..", "out", "main", "ai-vendor.cjs"),
  ];
  try {
    if (typeof appRoot === "function") {
      candidates.push(node_path.join(appRoot(), "out", "main", "ai-vendor.cjs"));
    }
  } catch {
    void 0;
  }
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod && typeof mod.streamText === "function") {
        aiSdkVendorCache = mod;
        return mod;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`ai-vendor.cjs is unavailable: ${String(lastError?.message || lastError || "not found")}`);
}

function aiCreateSdkModel({ provider, model }) {
  const sdk = aiLoadSdkVendor();
  const norm = String(provider || "").toLowerCase();
  if (norm === "local") {
    const ollama = sdk.createOpenAICompatible({
      name: "ollama",
      baseURL: "http://127.0.0.1:11434/v1",
    });
    return ollama.chatModel(model || "qwen2.5-coder:7b");
  }
  throw new Error(`Unsupported AI SDK provider: ${provider}`);
}

function aiStableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(aiStableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${aiStableStringify(value[k])}`).join(",")}}`;
}

function aiCreateDoomLoopTracker() {
  return __wideTs.aiCreateDoomLoopTracker();
}

function aiEnsureObjectSchema(schema) {
  const base = schema && typeof schema === "object" ? schema : {};
  const out = {
    type: "object",
    properties: base.properties && typeof base.properties === "object" ? base.properties : {},
  };
  if (Array.isArray(base.required) && base.required.length > 0) {
    out.required = base.required;
  }
  if (typeof base.additionalProperties === "boolean") {
    out.additionalProperties = base.additionalProperties;
  }
  return out;
}

function aiMessagesToSdk(messages) {
  const out = [];
  const raw = Array.isArray(messages) ? messages : [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const text = String(m.content ?? "");
    const images = typeof aiCleanImages === "function" ? aiCleanImages(m.images) : [];
    if (m.role === "user" && images.length > 0) {
      const parts = [{ type: "text", text: text || "Analyze the attached image." }];
      for (const img of images) {
        parts.push({
          type: "image",
          image: Buffer.from(img.data, "base64"),
          mediaType: img.mime,
        });
      }
      out.push({ role: "user", content: parts });
    } else {
      const clean = text.trim() ? text : m.role === "assistant" ? "..." : "";
      if (!clean) continue;
      if (out.length > 0 && out[out.length - 1].role === m.role && typeof out[out.length - 1].content === "string") {
        out[out.length - 1].content += `\n\n${clean}`;
      } else {
        out.push({ role: m.role, content: clean });
      }
    }
  }
  return out;
}

function aiBuildSdkToolSet({ root, allowWrites, toolMode = "full", allowBrowser = true, turnContext = null, send, latestUserText, tracker, signal = null }) {
  const sdk = aiLoadSdkVendor();
  const allSpecs = aiGetToolCatalog({ allowWrites, toolMode, allowBrowser });
  const toolSet = {};

  for (const spec of allSpecs) {
    if (!spec || !spec.name) continue;
    toolSet[spec.name] = sdk.tool({
      description: String(spec.description || spec.name),
      inputSchema: sdk.jsonSchema(aiEnsureObjectSchema(spec.parameters || spec.inputSchema)),
      execute: async (input, execOptions) => {
        const rawInput = input && typeof input === "object" ? input : {};
        const callId = execOptions?.toolCallId || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const blockedMsg = tracker ? tracker.check(spec.name, rawInput) : null;
        send({ type: "tool_start", id: callId, name: spec.name, input: rawInput });
        if (blockedMsg) {
          send({ type: "tool_end", id: callId, name: spec.name, result: blockedMsg });
          return blockedMsg;
        }
        let result;
        try {
          const toolSignal = execOptions?.abortSignal || signal;
          result = await aiRunTool(root, spec.name, rawInput, send, allowWrites, latestUserText, toolSignal, turnContext);
        } catch (error) {
          result = `That tool failed: ${String(error?.message || error)}`;
        }
        if (tracker) tracker.record(spec.name, rawInput, result);
        send({ type: "tool_end", id: callId, name: spec.name, result });
        return result;
      },
    });
  }
  return toolSet;
}

function aiProviderThinkingOptions() {
  return undefined;
}

async function aiStreamOnceSdk({ sdkModel, system, messages, tools, maxSteps, provider, effort, signal, send, emitToolErrors = true }) {
  const sdk = aiLoadSdkVendor();
  const filter = aiCreateStreamFilter(send);
  const providerOptions = aiProviderThinkingOptions(provider, effort);
  let answered = false;
  let said = "";
  let toolCallsCount = 0;

  const streamResult = sdk.streamText({
    model: sdkModel,
    system: system || undefined,
    messages,
    ...(tools ? { tools, stopWhen: sdk.stepCountIs(maxSteps) } : {}),
    abortSignal: signal,
    ...(providerOptions ? { providerOptions } : {}),
  });

  for await (const part of streamResult.fullStream) {
    if (signal?.aborted) {
      filter.flush();
      return { ok: false, error: "stopped", answered, said, toolCallsCount };
    }
    if (part.type === "text-delta") {
      const delta = String(part.text ?? "");
      if (delta) {
        answered = true;
        said += delta;
        filter.push(delta);
      }
    } else if (part.type === "reasoning-delta") {
      const delta = String(part.text ?? "");
      if (delta) send({ type: "thinking", text: delta });
    } else if (part.type === "tool-call") {
      toolCallsCount += 1;
    } else if (part.type === "tool-error" && emitToolErrors) {
      const errText = String(part.error?.message || part.error || "Tool call failed.");
      const tid = part.toolCallId || `err_${Date.now()}`;
      send({ type: "tool_start", id: tid, name: part.toolName || "tool", input: part.input ?? {} });
      send({ type: "tool_end", id: tid, name: part.toolName || "tool", result: errText });
    } else if (part.type === "finish") {
      const inputTokens = Number(part.totalUsage?.inputTokens || 0);
      const outputTokens = Number(part.totalUsage?.outputTokens || 0);
      if (inputTokens > 0 || outputTokens > 0) {
        send({ type: "usage", input: inputTokens, output: outputTokens, total: inputTokens + outputTokens });
        if (typeof aiRecordCloudUsage === "function" && provider !== "local") {
          aiRecordCloudUsage(provider, inputTokens, outputTokens);
        }
      }
    } else if (part.type === "error") {
      filter.flush();
      const err = part.error instanceof Error ? part.error : new Error(String(part.error || "Stream failed."));
      throw err;
    }
  }
  filter.flush();
  return { ok: true, answered, said, toolCallsCount };
}

async function aiRunTextToolFallbackLoop({ sdkModel, root, system, initialMessages, allowWrites, turnContext = null, maxSteps, provider, effort, signal, send, latestUserText, tracker }) {
  const conv = [...initialMessages];
  let answeredAny = false;

  for (let round = 0; round < maxSteps; round += 1) {
    if (signal?.aborted) return { ok: false, error: "stopped" };
    const step = await aiStreamOnceSdk({
      sdkModel,
      system,
      messages: conv,
      tools: undefined,
      maxSteps: 1,
      provider,
      effort,
      signal,
      send,
      emitToolErrors: false,
    });
    if (!step.ok) return step;
    answeredAny = answeredAny || step.answered;

    const textCalls = aiExtractTextToolCalls(step.said);
    if (textCalls.length === 0) {
      return { ok: true, answered: answeredAny };
    }

    conv.push({ role: "assistant", content: step.said });
    const resultBlocks = [];
    for (let i = 0; i < textCalls.length; i += 1) {
      const tc = textCalls[i];
      const callId = `text-${round}-${i}`;
      const rawInput = tc.input && typeof tc.input === "object" ? tc.input : {};
      const blockedMsg = tracker.check(tc.name, rawInput);
      send({ type: "tool_start", id: callId, name: tc.name, input: rawInput });
      const result = blockedMsg
        ? blockedMsg
        : await aiRunTool(root, tc.name, rawInput, send, allowWrites, latestUserText, signal, turnContext);
      if (!blockedMsg) tracker.record(tc.name, rawInput, result);
      send({ type: "tool_end", id: callId, name: tc.name, result });
      resultBlocks.push(`<tool_result name="${tc.name}">\n${result}\n</tool_result>`);
      if (signal?.aborted) return { ok: false, error: "stopped" };
    }
    conv.push({ role: "user", content: resultBlocks.join("\n\n") });
  }
  return { ok: false, error: "too-many-rounds" };
}

async function aiRunUnifiedTurn({ provider, model, key, root, system, systemWithXmlCatalog, messages, allowWrites, toolMode = "full", allowBrowser = true, turnContext = null, effort = "fast", signal, send }) {
  const sdkModel = aiCreateSdkModel({ provider, model, key });
  const sdkMessages = aiMessagesToSdk(messages);
  const latestUserText = aiGetLatestUserText(messages);
  const tracker = aiCreateDoomLoopTracker();
  const maxSteps = effort === "thinking" ? AI_MAX_TOOL_ROUNDS : 16;
  const sdkTools = aiBuildSdkToolSet({ root, allowWrites, toolMode, allowBrowser, turnContext, send, latestUserText, tracker, signal });

  try {
    const res = await aiStreamOnceSdk({
      sdkModel,
      system,
      messages: sdkMessages,
      tools: sdkTools,
      maxSteps,
      provider,
      effort,
      signal,
      send,
    });
    if (!res.ok) return res;
    return { ok: true, answered: res.answered };
  } catch (error) {
    if (signal?.aborted) return { ok: false, error: "stopped" };
    const msg = String(error?.message || error || "");
    if (provider === "local" && /does not support tools|tool.?use.*not supported|unknown field.*tools|invalid_request_error|400/i.test(msg)) {
      return aiRunTextToolFallbackLoop({
        sdkModel,
        root,
        system: systemWithXmlCatalog || system,
        initialMessages: sdkMessages,
        allowWrites,
        turnContext,
        maxSteps,
        provider,
        effort,
        signal,
        send,
        latestUserText,
        tracker,
      });
    }
    if (typeof error?.statusCode === "number" || msg) {
      throw error;
    }
    return { ok: false, error: "stream-failed" };
  }
}

async function aiCompleteSdk({ provider, model, key, system, messages, signal }) {
  const sdk = aiLoadSdkVendor();
  const sdkModel = aiCreateSdkModel({ provider, model, key });
  const sdkMessages = aiMessagesToSdk(messages);
  const res = await sdk.generateText({
    model: sdkModel,
    system: system || undefined,
    messages: sdkMessages,
    maxOutputTokens: 256,
    abortSignal: signal,
  });
  return String(res.text || "");
}

async function aiCompactSdk({ provider, model, key, messages, signal }) {
  const older = Array.isArray(messages) ? messages : [];
  if (older.length === 0) return "";
  const transcript = older
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content || "").slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 48000);

  if (provider === "claude-code" || provider === "antigravity" || provider === "codex" || (!key && provider !== "local")) {
    return older
      .map((m) => `- ${m.role === "user" ? "User" : "Assistant"}: ${String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 220)}`)
      .join("\n");
  }

  try {
    const sdk = aiLoadSdkVendor();
    const sdkModel = aiCreateSdkModel({ provider, model, key });
    const res = await sdk.generateText({
      model: sdkModel,
      system: "Summarize the technical conversation below concisely for continuing the coding and security session. Preserve exact file paths, URLs, ports, tool findings, user decisions, and pending next steps. Output clean plain text bullets only with zero meta-commentary.",
      messages: [{ role: "user", content: transcript }],
      maxOutputTokens: 900,
      abortSignal: signal,
    });
    return String(res.text || "").trim();
  } catch {
    return older
      .map((m) => `- ${m.role === "user" ? "User" : "Assistant"}: ${String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 220)}`)
      .join("\n");
  }
}
