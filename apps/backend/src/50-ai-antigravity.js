const AGY_HOST = "127.0.0.1";
const AGY_WORKER_IDLE_MS = 15 * 60 * 1000;
const AGY_EXEC_TIMEOUT_MS = 15000;
const AGY_INSTALL_TIMEOUT_MS = 180000;
const AGY_COMPLETE_TIMEOUT_MS = 30000;
const AGY_COMPACT_TIMEOUT_MS = 90000;
const AGY_NATIVE_EDIT_TOOLS = new Set([
  "write_file",
  "edit_file",
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
]);
const AGY_WORKERS = new Map();

let agyBridge = null;
let agyCurrentTurnCtx = null;
let agyCachedModels = null;
let agyLastSignedIn = null;

async function antigravityPath() {
  const override = String(process.env.WIDE_AGY_PATH || "").trim();
  if (override) {
    try {
      const st = await promises.stat(override);
      if (st.isFile()) return override;
    } catch {}
  }

  const candidates = [];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || node_path.join(node_os.homedir(), "AppData", "Local");
    candidates.push(
      node_path.join(localAppData, "agy", "bin", "agy.exe"),
      node_path.join(node_os.homedir(), ".local", "bin", "agy.exe"),
      node_path.join(node_os.homedir(), "AppData", "Local", "Programs", "agy", "agy.exe"),
    );
  } else {
    candidates.push(
      node_path.join(node_os.homedir(), ".local", "bin", "agy"),
      node_path.join(node_os.homedir(), ".agy", "bin", "agy"),
      "/usr/local/bin/agy",
      "/opt/homebrew/bin/agy",
      "/usr/bin/agy",
    );
  }

  for (const candidate of candidates) {
    try {
      const st = await promises.stat(candidate);
      if (st.isFile()) return candidate;
    } catch {}
  }

  const locator = process.platform === "win32" ? "where.exe" : "which";
  return await new Promise((resolve) => {
    node_child_process.execFile(
      locator,
      ["agy"],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve("");
        const lines = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.length === 0) return resolve("");
        if (process.platform === "win32") {
          const exe = lines.find((line) => /\.exe$/i.test(line)) || lines.find((line) => /\.(cmd|bat)$/i.test(line));
          return resolve(exe || lines[0]);
        }
        return resolve(lines[0]);
      },
    );
  });
}

function antigravityBuildSpawnSpec(binPath, args) {
  const env = { ...process.env };
  if (/\.(js|mjs|cjs)$/i.test(binPath)) {
    return { command: process.execPath, args: [binPath, ...args], env };
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binPath)) {
    return { command: "cmd.exe", args: ["/d", "/c", binPath, ...args], env };
  }
  return { command: binPath, args, env };
}

async function antigravityExecCapture(binPath, args, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : AGY_EXEC_TIMEOUT_MS;
  const spec = antigravityBuildSpawnSpec(binPath, args);

  return await new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    try {
      const child = node_child_process.spawn(spec.command, spec.args, {
        cwd: opts.cwd || undefined,
        env: spec.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {}
      }, timeoutMs);

      const onAbort = () => {
        try {
          child.kill("SIGKILL");
        } catch {}
      };
      if (opts.signal) {
        if (opts.signal.aborted) {
          onAbort();
        } else {
          opts.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        finish({ ok: false, code: -1, stdout, stderr: err.message, timedOut });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        finish({
          ok: !timedOut && code === 0,
          code: typeof code === "number" ? code : -1,
          stdout,
          stderr,
          timedOut,
        });
      });

      if (typeof opts.stdinText === "string" && opts.stdinText.length > 0) {
        try {
          child.stdin?.write(opts.stdinText);
        } catch {}
      }
      try {
        child.stdin?.end();
      } catch {}
    } catch (err) {
      finish({ ok: false, code: -1, stdout: "", stderr: err.message, timedOut: false });
    }
  });
}

function antigravityHasWideMcp(stdout) {
  return /^\s*wide\b/im.test(String(stdout || ""));
}

async function antigravityListModels(binPath) {
  const resolvedBin = binPath || (await antigravityPath());
  if (!resolvedBin) {
    return {
      ok: false,
      models: agyCachedModels || [...__wideTs.DEFAULT_ANTIGRAVITY_MODELS],
      error: "Antigravity CLI is not installed.",
    };
  }
  const res = await antigravityExecCapture(resolvedBin, ["models"], { timeoutMs: 12000 });
  const parsed = __wideTs.parseAntigravityModelsOutput(res.stdout);
  if (res.ok && parsed.length > 0) {
    agyCachedModels = parsed;
    agyLastSignedIn = true;
    return { ok: true, models: parsed, error: "" };
  }
  const combined = `${res.stdout}\n${res.stderr}`.trim();
  const classified = combined ? __wideTs.classifyAntigravityError(combined) : null;
  if (classified?.kind === "auth") {
    agyLastSignedIn = false;
  }
  return {
    ok: res.ok && parsed.length > 0,
    models: parsed.length > 0 ? parsed : (agyCachedModels || [...__wideTs.DEFAULT_ANTIGRAVITY_MODELS]),
    error: res.ok ? "" : (classified?.message || combined),
  };
}

function antigravityHasLocalAuthFile() {
  const candidates = [
    node_path.join(node_os.homedir(), ".gemini", "antigravity", "antigravity_state.pbtxt"),
    node_path.join(node_os.homedir(), ".gemini", "antigravity-cli", "jetski_state.pbtxt"),
  ];
  for (const candidate of candidates) {
    try {
      const st = node_fs.statSync(candidate);
      if (st.isFile() && st.size > 0) return true;
    } catch {}
  }
  return false;
}

async function antigravityReadStatus(opts = {}) {
  const binPath = await antigravityPath();
  if (!binPath) {
    return {
      installed: false,
      signedIn: false,
      version: "",
      account: "",
      mcpAttached: false,
      models: agyCachedModels || [...__wideTs.DEFAULT_ANTIGRAVITY_MODELS],
      path: "",
    };
  }

  const [verRes, modelsRes, mcpRes] = await Promise.all([
    antigravityExecCapture(binPath, ["--version"], { timeoutMs: 5000 }),
    antigravityExecCapture(binPath, ["models"], { timeoutMs: 12000 }),
    antigravityExecCapture(binPath, ["mcp", "list"], { timeoutMs: 8000 }),
  ]);

  const versionText = String(verRes.stdout || verRes.stderr || "").trim();
  const versionMatch = versionText.match(/v?(\d+\.\d+(?:\.\d+)*)/i);
  const version = versionMatch ? versionMatch[1] : versionText.split(/\r?\n/)[0]?.trim() || "";

  const parsedModels = __wideTs.parseAntigravityModelsOutput(modelsRes.stdout);
  if (parsedModels.length > 0) {
    agyCachedModels = parsedModels;
  }

  const combinedErr = `${modelsRes.stdout}\n${modelsRes.stderr}`.trim();
  const errInfo = !modelsRes.ok && combinedErr ? __wideTs.classifyAntigravityError(combinedErr) : null;

  let signedIn = false;
  if (errInfo?.kind === "auth") {
    signedIn = false;
  } else if (modelsRes.ok && parsedModels.length > 0) {
    signedIn = true;
  } else if (!opts.force && agyLastSignedIn !== null) {
    signedIn = agyLastSignedIn;
  } else if (modelsRes.ok) {
    signedIn = antigravityHasLocalAuthFile();
  }
  agyLastSignedIn = signedIn;

  return {
    installed: true,
    signedIn,
    version,
    account: "",
    mcpAttached: antigravityHasWideMcp(mcpRes.stdout),
    models: parsedModels.length > 0 ? parsedModels : (agyCachedModels || [...__wideTs.DEFAULT_ANTIGRAVITY_MODELS]),
    path: binPath,
  };
}

async function antigravityInstall() {
  return await new Promise((resolve) => {
    let settled = false;
    let output = "";
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    try {
      const cmd =
        process.platform === "win32"
          ? "powershell.exe"
          : "bash";
      const args =
        process.platform === "win32"
          ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://antigravity.google/cli/install.ps1 | iex"]
          : ["-c", "curl -fsSL https://antigravity.google/cli/install.sh | bash"];

      const child = node_child_process.spawn(cmd, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish({ ok: false, error: "Antigravity CLI install timed out.", output });
      }, AGY_INSTALL_TIMEOUT_MS);

      child.stdout?.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        output += chunk.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        finish({ ok: false, error: err.message, output });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        finish({
          ok: code === 0,
          output: output.slice(-4000),
          ...(code !== 0 ? { error: output.trim().split(/\r?\n/).slice(-3).join(" ") || `Exit code ${code}` } : {}),
        });
      });
    } catch (err) {
      finish({ ok: false, error: err.message, output });
    }
  });
}

async function antigravityOpenLoginTerminal(binPath) {
  const quoted = `"${binPath.replace(/"/g, '\\"')}"`;
  if (process.platform === "win32") {
    const cmdLine = /\.(js|mjs|cjs)$/i.test(binPath)
      ? `"${process.execPath}" ${quoted}`
      : quoted;
    node_child_process.spawn(
      "cmd.exe",
      ["/c", "start", "Wide - Antigravity Sign In", "cmd.exe", "/k", cmdLine],
      { detached: true, windowsHide: false, stdio: "ignore" },
    ).unref();
    return { ok: true, started: true };
  }
  if (process.platform === "darwin") {
    const safeCmd = binPath.replace(/"/g, '\\"');
    node_child_process.spawn(
      "osascript",
      ["-e", `tell application "Terminal" to do script "\\"${safeCmd}\\""`],
      { detached: true, stdio: "ignore" },
    ).unref();
    return { ok: true, started: true };
  }
  const terminals = [
    ["x-terminal-emulator", ["-e", binPath]],
    ["gnome-terminal", ["--", binPath]],
    ["konsole", ["-e", binPath]],
    ["xterm", ["-e", binPath]],
  ];
  for (const [term, tArgs] of terminals) {
    try {
      node_child_process.spawn(term, tArgs, { detached: true, stdio: "ignore" }).unref();
      return { ok: true, started: true };
    } catch {}
  }
  return { ok: false, error: "Could not open terminal. Run 'agy' in your terminal to sign in." };
}

function antigravitySendJsonRpc(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(payload === null ? "" : JSON.stringify(payload));
}

async function antigravityEnsureBridge() {
  if (agyBridge) return agyBridge;

  const token = node_crypto.randomBytes(24).toString("hex");
  const sockets = new Set();

  const server = node_http.createServer((req, res) => {
    const offered = String(req.headers.authorization || "");
    if (offered !== `Bearer ${token}`) {
      antigravitySendJsonRpc(res, 401, { error: "unauthorized" });
      return;
    }

    if (req.method === "GET") {
      antigravitySendJsonRpc(res, 200, { ok: true, server: "wide-antigravity-mcp" });
      return;
    }

    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on("end", async () => {
      let msg = null;
      try {
        msg = raw ? JSON.parse(raw) : {};
      } catch {
        antigravitySendJsonRpc(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        return;
      }

      const id = msg && Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : null;
      const method = String(msg?.method || "");
      const params = msg?.params && typeof msg.params === "object" ? msg.params : {};
      const ctx = agyCurrentTurnCtx || {};

      if (method === "notifications/initialized" || method === "notifications/cancelled") {
        antigravitySendJsonRpc(res, 202, null);
        return;
      }

      if (method === "initialize") {
        antigravitySendJsonRpc(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: String(params.protocolVersion || "2024-11-05"),
            capabilities: { tools: {} },
            serverInfo: { name: "wide-antigravity-mcp", version: "1.0.0" },
          },
        });
        return;
      }

      if (method === "ping") {
        antigravitySendJsonRpc(res, 200, { jsonrpc: "2.0", id, result: {} });
        return;
      }

      if (method === "tools/list") {
        const specs = __wideTs.aiFilterToolsForClaudeMcp(AI_TOOLS, {
          toolMode: ctx.toolMode || "full",
          allowWrites: Boolean(ctx.allowWrites),
          allowBrowser: Boolean(ctx.allowBrowser),
        });
        const tools = specs.map((spec) => ({
          name: spec.name,
          description: spec.description || "",
          inputSchema: spec.parameters || { type: "object", properties: {} },
        }));
        antigravitySendJsonRpc(res, 200, { jsonrpc: "2.0", id, result: { tools } });
        return;
      }

      if (method === "tools/call") {
        if (!ctx.root || typeof ctx.send !== "function") {
          antigravitySendJsonRpc(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: "Wide workspace turn is not active." }],
              isError: true,
            },
          });
          return;
        }
        const toolName = String(params.name || "");
        const toolInput = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
        const allowedSpecs = __wideTs.aiFilterToolsForClaudeMcp(AI_TOOLS, {
          toolMode: ctx.toolMode || "full",
          allowWrites: Boolean(ctx.allowWrites),
          allowBrowser: Boolean(ctx.allowBrowser),
        });
        if (!allowedSpecs.some((spec) => spec.name === toolName)) {
          antigravitySendJsonRpc(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Tool not enabled in current mode: ${toolName}` }],
              isError: true,
            },
          });
          return;
        }
        try {
          const out = await aiRunTool(
            ctx.root,
            toolName,
            toolInput,
            ctx.send,
            Boolean(ctx.allowWrites),
            ctx.userPrompt || "",
            ctx.signal,
            ctx.turnContext,
          );
          const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
          antigravitySendJsonRpc(res, 200, {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text }], isError: false },
          });
        } catch (err) {
          antigravitySendJsonRpc(res, 200, {
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: err.message }], isError: true },
          });
        }
        return;
      }

      antigravitySendJsonRpc(res, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, AGY_HOST, () => {
      server.removeListener("error", reject);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  agyBridge = {
    url: `http://${AGY_HOST}:${port}/mcp`,
    token,
    port,
    close: () => {
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {}
      }
      try {
        server.close();
      } catch {}
      agyBridge = null;
    },
  };
  return agyBridge;
}

async function antigravitySyncWideMcpUrl(binPath, forceAttach = false) {
  if (!binPath) return { attached: false, error: "Antigravity CLI is not installed." };
  if (!forceAttach) {
    const listRes = await antigravityExecCapture(binPath, ["mcp", "list"], { timeoutMs: 8000 });
    if (!antigravityHasWideMcp(listRes.stdout)) {
      return { attached: false };
    }
  }
  const bridge = await antigravityEnsureBridge();
  const addRes = await antigravityExecCapture(
    binPath,
    ["mcp", "add", "--header", `Authorization: Bearer ${bridge.token}`, "--type", "http", "wide", bridge.url],
    { timeoutMs: 10000 },
  );
  return {
    attached: addRes.ok,
    url: bridge.url,
    error: addRes.ok ? "" : (addRes.stderr || addRes.stdout || "Failed to register Wide MCP server.").trim(),
  };
}

function antigravityExtractUserMessagePayload(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let lastUserIdx = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (String(list[i]?.role || "").toLowerCase() === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const target = lastUserIdx >= 0 ? list[lastUserIdx] : null;
  const prior = lastUserIdx > 0 ? list.slice(0, lastUserIdx) : [];

  let text = "";
  const images = [];
  if (target) {
    if (Array.isArray(target.content)) {
      const parts = [];
      for (const block of target.content) {
        if (!block) continue;
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        } else if (block.type === "image" && block.source?.type === "base64" && block.source?.data) {
          images.push({
            mediaType: block.source.media_type || "image/png",
            data: block.source.data,
          });
        }
      }
      text = parts.join("\n").trim();
    } else {
      text = String(target.content ?? "").trim();
    }
    if (Array.isArray(target.images)) {
      for (const img of target.images) {
        if (img?.data) {
          images.push({
            mediaType: img.mime || img.mediaType || img.media_type || "image/png",
            data: img.data,
          });
        }
      }
    }
  }

  return { text, images, priorMessages: prior };
}

function antigravityFormatPriorHistory(priorMessages) {
  if (!Array.isArray(priorMessages) || priorMessages.length === 0) return "";
  const recent = priorMessages.slice(-14);
  const lines = ["[Prior Conversation Summary]"];
  for (const msg of recent) {
    const role = String(msg?.role || "user").toUpperCase();
    const rawText = Array.isArray(msg?.content)
      ? msg.content.filter((b) => b?.type === "text").map((b) => String(b.text || "")).join("\n")
      : String(msg?.content ?? "");
    const clean = rawText.trim();
    if (!clean) continue;
    lines.push(`${role}: ${clean.length > 2400 ? `${clean.slice(0, 2400)}...` : clean}`);
  }
  lines.push("[End Prior Conversation]");
  return lines.length > 2 ? lines.join("\n") : "";
}

function antigravityBuildTurnPrompt({
  userText,
  root,
  system,
  language,
  activeFile,
  openTabs,
  priorMessages,
  resumedConversation,
  includeWideToolsHint,
  allowBrowser,
  toolMode,
}) {
  const sections = [];
  if (root) {
    const meta = [`Workspace Root: ${root}`];
    if (language) meta.push(`User UI Language: ${language}`);
    if (activeFile) meta.push(`Active Editor File: ${activeFile}`);
    if (Array.isArray(openTabs) && openTabs.length > 0) {
      meta.push(`Open Tabs: ${openTabs.slice(0, 20).join(", ")}`);
    }
    sections.push(`[Wide Workspace Context]\n${meta.join("\n")}`);
  }
  if (typeof system === "string" && system.trim()) {
    sections.push(system.trim());
  }
  if (includeWideToolsHint) {
    const uniqueTools = __wideTs.aiFilterToolsForClaudeMcp(AI_TOOLS, {
      toolMode: toolMode || "full",
      allowWrites: true,
      allowBrowser: Boolean(allowBrowser),
    });
    if (uniqueTools.length > 0) {
      sections.push(
        `[Wide Security & IDE MCP Tools]\nThe 'wide' MCP server provides additional security and workspace tools: ${uniqueTools.map((t) => t.name).join(", ")}.`,
      );
    }
    if (__wideTs?.aiBuildWideCapabilityPlaybook) {
      sections.push(
        __wideTs.aiBuildWideCapabilityPlaybook({
          toolMode: toolMode || "full",
          allowBrowser: Boolean(allowBrowser),
          allowWrites: true,
          isExternalCli: true,
        }),
      );
    }
  }
  if (!resumedConversation) {
    const historyBlock = antigravityFormatPriorHistory(priorMessages);
    if (historyBlock) sections.push(historyBlock);
  }
  sections.push(userText || "Continue.");
  return sections.join("\n\n");
}

function antigravityExtractFilePath(input) {
  if (!input || typeof input !== "object") return "";
  return String(
    input.Path ??
    input.path ??
    input.TargetFile ??
    input.target_file ??
    input.AbsolutePath ??
    input.absolute_path ??
    input.file_path ??
    input.filePath ??
    "",
  ).trim();
}

function antigravityTakePreEditSnapshot(root, input) {
  const filePath = antigravityExtractFilePath(input);
  if (!filePath || !root) return null;
  const resolved = aiResolvePath(root, filePath);
  if (!resolved) return null;
  const relPath = node_path.relative(root, resolved).replace(/\\/g, "/");
  let beforeContent = "";
  let existed = false;
  try {
    beforeContent = node_fs.readFileSync(resolved, "utf8");
    existed = true;
  } catch {
    beforeContent = "";
    existed = false;
  }
  return { resolved, relPath, beforeContent, existed };
}

async function antigravityFlushEditSnapshot(root, snap, send) {
  if (!snap || !root) return;
  let afterContent = "";
  let existsNow = false;
  try {
    afterContent = node_fs.readFileSync(snap.resolved, "utf8");
    existsNow = true;
  } catch {
    afterContent = "";
    existsNow = false;
  }
  if (!existsNow && !snap.existed) return;
  if (existsNow && snap.existed && afterContent === snap.beforeContent) return;
  const counts = aiDiffCounts(snap.beforeContent, afterContent);
  send({
    type: "edit",
    root,
    path: snap.relPath,
    oldContent: snap.beforeContent,
    content: afterContent,
    existed: snap.existed,
    staged: false,
    added: counts.added,
    removed: counts.removed,
  });
  await aiVerifyEditedFile(root, snap.resolved, snap.relPath, afterContent, false, send);
}

function antigravityWorkerSignature(opts) {
  return JSON.stringify({
    root: opts.root || "",
    model: opts.model || "",
    effort: opts.effort || "",
    mode: opts.mode || "agent",
    mcpAttached: Boolean(opts.mcpAttached),
  });
}

function antigravityDisposeWorker(worker) {
  if (!worker || worker.disposed) return;
  worker.disposed = true;
  if (worker.idleTimer) {
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
  }
  if (AGY_WORKERS.get(worker.sessionId) === worker) {
    AGY_WORKERS.delete(worker.sessionId);
  }
  if (worker.activeTurn && !worker.activeTurn.settled) {
    const turn = worker.activeTurn;
    worker.activeTurn = null;
    turn.reject(new Error("Antigravity session stopped."));
  }
  try {
    worker.child?.kill("SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      worker.child?.kill("SIGKILL");
    } catch {}
  }, 400);
}

function aiCloseAntigravitySession(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) return false;
  const worker = AGY_WORKERS.get(sid);
  if (worker) antigravityDisposeWorker(worker);
  if (typeof setAiSessionAntigravityMeta === "function") {
    void setAiSessionAntigravityMeta(sid, { conversationId: "" }).catch(() => {});
  }
  return Boolean(worker);
}

function antigravityStopAll() {
  for (const worker of Array.from(AGY_WORKERS.values())) {
    antigravityDisposeWorker(worker);
  }
  AGY_WORKERS.clear();
  if (agyBridge) {
    agyBridge.close();
  }
}

function antigravityTouchWorkerIdle(worker) {
  if (!worker || worker.disposed) return;
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  worker.idleTimer = setTimeout(() => {
    if (!worker.activeTurn) {
      antigravityDisposeWorker(worker);
    }
  }, AGY_WORKER_IDLE_MS);
}

function antigravitySpawnWorker({
  binPath,
  sessionId,
  root,
  conversationId,
  model,
  effort,
  mode,
  signature,
}) {
  const args = __wideTs.buildAntigravityCliArgs({
    conversationId,
    model,
    effort,
    mode,
  });
  const spec = antigravityBuildSpawnSpec(binPath, args);
  const child = node_child_process.spawn(spec.command, spec.args, {
    cwd: root || process.cwd(),
    env: spec.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const worker = {
    sessionId,
    signature,
    child,
    disposed: false,
    hasDispatched: false,
    conversationId: conversationId || "",
    activeTurn: null,
    idleTimer: null,
    stderrBuf: "",
    lineQueue: Promise.resolve(),
  };

  let lineBuf = "";

  const processLine = async (line) => {
    const turn = worker.activeTurn;
    if (!turn || turn.settled) return;

    const events = turn.parser.parseLine(line);
    for (const ev of events) {
      if (ev.type === "session_init") {
        if (ev.conversationId) {
          worker.conversationId = ev.conversationId;
          turn.conversationId = ev.conversationId;
          if (sessionId && typeof setAiSessionAntigravityMeta === "function") {
            void setAiSessionAntigravityMeta(sessionId, { conversationId: ev.conversationId }).catch(() => {});
          }
        }
        continue;
      }

      if (ev.type === "thinking") {
        turn.send({ type: "thinking", text: ev.text });
        continue;
      }

      if (ev.type === "delta") {
        turn.emittedText = true;
        turn.finalText += ev.text;
        turn.send({ type: "text", text: ev.text });
        continue;
      }

      if (ev.type === "tool_start") {
        turn.emittedTool = true;
        if (AGY_NATIVE_EDIT_TOOLS.has(ev.tool)) {
          const snap = antigravityTakePreEditSnapshot(turn.root, ev.input);
          if (snap) {
            turn.editSnapshots.set(ev.id, snap);
          }
        }
        turn.send({ type: "tool_start", name: ev.tool, input: ev.input });
        continue;
      }

      if (ev.type === "tool_result") {
        const snap = turn.editSnapshots.get(ev.id);
        if (snap) {
          turn.editSnapshots.delete(ev.id);
          await antigravityFlushEditSnapshot(turn.root, snap, turn.send);
        }
        turn.send({
          type: "tool_end",
          name: ev.tool,
          result: ev.output,
          ...(ev.isError ? { error: ev.output } : {}),
        });
        continue;
      }

      if (ev.type === "usage") {
        const total =
          ev.inputTokens +
          ev.outputTokens +
          ev.thinkingTokens +
          ev.cacheReadTokens;
        turn.send({
          type: "usage",
          input: ev.inputTokens,
          output: ev.outputTokens,
          total,
          ...(ev.cacheReadTokens > 0 ? { cacheRead: ev.cacheReadTokens } : {}),
          ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}),
        });
        continue;
      }

      if (ev.type === "result") {
        if (ev.conversationId) {
          worker.conversationId = ev.conversationId;
          turn.conversationId = ev.conversationId;
          if (sessionId && typeof setAiSessionAntigravityMeta === "function") {
            void setAiSessionAntigravityMeta(sessionId, { conversationId: ev.conversationId }).catch(() => {});
          }
        }
        for (const [eid, snap] of Array.from(turn.editSnapshots.entries())) {
          turn.editSnapshots.delete(eid);
          await antigravityFlushEditSnapshot(turn.root, snap, turn.send);
        }
        if (ev.isError) {
          turn.resolve({
            ok: false,
            error: ev.text || "Antigravity CLI execution failed.",
            errorKind: ev.errorKind || "unknown",
            emittedAnything: turn.emittedText || turn.emittedTool,
            conversationId: worker.conversationId,
          });
        } else {
          if (!turn.emittedText && ev.text) {
            turn.finalText = ev.text;
            turn.send({ type: "text", text: ev.text });
          }
          turn.resolve({
            ok: true,
            text: turn.finalText || ev.text || "",
            conversationId: worker.conversationId,
          });
        }
      }
    }
  };

  child.stdout?.on("data", (chunk) => {
    lineBuf += chunk.toString();
    let idx;
    while ((idx = lineBuf.indexOf("\n")) >= 0) {
      const line = lineBuf.slice(0, idx).replace(/\r$/, "");
      lineBuf = lineBuf.slice(idx + 1);
      if (line.trim()) {
        worker.lineQueue = worker.lineQueue.then(() => processLine(line)).catch((err) => {
          const active = worker.activeTurn;
          if (active && !active.settled) {
            active.resolve({
              ok: false,
              error: String(err?.message || err || "Antigravity stream parser error."),
              errorKind: "unknown",
              emittedAnything: active.emittedText || active.emittedTool,
              conversationId: worker.conversationId,
            });
          }
        });
      }
    }
  });

  child.stderr?.on("data", (chunk) => {
    worker.stderrBuf = (worker.stderrBuf + chunk.toString()).slice(-12000);
  });

  child.on("error", (err) => {
    const turn = worker.activeTurn;
    worker.disposed = true;
    if (AGY_WORKERS.get(sessionId) === worker) AGY_WORKERS.delete(sessionId);
    if (turn && !turn.settled) {
      worker.activeTurn = null;
      turn.resolve({
        ok: false,
        error: err.message,
        errorKind: "unknown",
        emittedAnything: turn.emittedText || turn.emittedTool,
        conversationId: worker.conversationId,
      });
    }
  });

  child.on("close", (code) => {
    const rem = lineBuf.trim();
    if (rem) {
      lineBuf = "";
      worker.lineQueue = worker.lineQueue.then(() => processLine(rem)).catch(() => {});
    }
    worker.lineQueue.finally(() => {
      worker.disposed = true;
      if (AGY_WORKERS.get(sessionId) === worker) AGY_WORKERS.delete(sessionId);
      const turn = worker.activeTurn;
      if (turn && !turn.settled) {
        worker.activeTurn = null;
        if (turn.aborted) {
          turn.resolve({ ok: true, text: turn.finalText || "", aborted: true });
          return;
        }
        const detail = worker.stderrBuf.trim();
        const classified = detail
          ? __wideTs.classifyAntigravityError(detail)
          : { kind: "unknown", message: `Antigravity process exited with code ${code ?? -1}.` };
        turn.resolve({
          ok: false,
          error: classified.message,
          errorKind: classified.kind,
          emittedAnything: turn.emittedText || turn.emittedTool,
          conversationId: worker.conversationId,
        });
      }
    });
  });

  AGY_WORKERS.set(sessionId, worker);
  antigravityTouchWorkerIdle(worker);
  return worker;
}

function antigravityDispatchTurn(worker, { promptText, images, root, send, signal }) {
  return new Promise((resolve, reject) => {
    const turn = {
      root,
      send,
      parser: new __wideTs.AntigravityStreamEventParser(),
      editSnapshots: new Map(),
      emittedText: false,
      emittedTool: false,
      finalText: "",
      aborted: false,
      settled: false,
      conversationId: worker.conversationId,
      resolve: (payload) => {
        if (turn.settled) return;
        turn.settled = true;
        cleanup();
        worker.activeTurn = null;
        antigravityTouchWorkerIdle(worker);
        resolve(payload);
      },
      reject: (err) => {
        if (turn.settled) return;
        turn.settled = true;
        cleanup();
        worker.activeTurn = null;
        antigravityTouchWorkerIdle(worker);
        reject(err);
      },
    };

    const onAbort = () => {
      turn.aborted = true;
      antigravityDisposeWorker(worker);
      turn.resolve({ ok: true, text: turn.finalText || "", aborted: true });
    };

    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    worker.activeTurn = turn;
    if (worker.idleTimer) {
      clearTimeout(worker.idleTimer);
      worker.idleTimer = null;
    }

    const line = __wideTs.serializeAntigravityStreamUserMessage({ text: promptText, images });
    try {
      worker.child.stdin.write(`${line}\n`);
      worker.hasDispatched = true;
    } catch (err) {
      turn.resolve({
        ok: false,
        error: err.message,
        errorKind: "unknown",
        emittedAnything: false,
        conversationId: worker.conversationId,
      });
    }
  });
}

async function aiRunAntigravityTurn({
  root,
  sessionId,
  model,
  effort,
  system,
  messages,
  allowWrites,
  toolMode,
  allowBrowser,
  interactionMode,
  language,
  activeFile,
  openTabs,
  turnContext,
  signal,
  send,
}) {
  const binPath = await antigravityPath();
  if (!binPath) {
    const errText = "Antigravity CLI is not installed. Open Model Picker -> Antigravity to install it.";
    send({ type: "error", message: errText, errorKind: "unknown" });
    return { ok: false, error: errText };
  }

  const effectiveSid = String(sessionId || `agy:${root || "default"}`).trim();
  const mode = String(interactionMode || "").toLowerCase() === "ask" || !allowWrites ? "ask" : "agent";
  const normEffort = __wideTs.normalizeAntigravityEffort(effort) || "high";
  const catalog = agyCachedModels && agyCachedModels.length > 0 ? agyCachedModels : __wideTs.DEFAULT_ANTIGRAVITY_MODELS;
  const resolvedModel = __wideTs.resolveAntigravityModelForEffort(model, normEffort, catalog);
  const { text: userText, images, priorMessages } = antigravityExtractUserMessagePayload(messages);

  const prevCtx = agyCurrentTurnCtx;
  agyCurrentTurnCtx = {
    root,
    send,
    allowWrites: mode === "agent" && Boolean(allowWrites),
    toolMode: toolMode || "full",
    allowBrowser: Boolean(allowBrowser),
    userPrompt: userText,
    signal,
    turnContext,
  };

  try {
    const mcpSync = await antigravitySyncWideMcpUrl(binPath, false);
    const meta =
      effectiveSid && typeof getAiSessionAntigravityMeta === "function"
        ? await getAiSessionAntigravityMeta(effectiveSid).catch(() => null)
        : null;
    let storedConvId = String(meta?.conversationId || "").trim();

    const sig = antigravityWorkerSignature({
      root,
      model: resolvedModel,
      effort: normEffort,
      mode,
      mcpAttached: mcpSync.attached,
    });

    const runAttempt = async (resumeConvId) => {
      let worker = AGY_WORKERS.get(effectiveSid);
      if (worker && (worker.disposed || worker.signature !== sig)) {
        const preservedConv = worker.conversationId || resumeConvId;
        antigravityDisposeWorker(worker);
        worker = null;
        if (preservedConv) resumeConvId = preservedConv;
      }

      const isFreshWorker = !worker;
      if (!worker) {
        worker = antigravitySpawnWorker({
          binPath,
          sessionId: effectiveSid,
          root,
          conversationId: resumeConvId,
          model: resolvedModel,
          effort: normEffort,
          mode,
          signature: sig,
        });
      }

      const promptText = isFreshWorker
        ? antigravityBuildTurnPrompt({
            userText,
            root,
            system,
            language,
            activeFile,
            openTabs,
            priorMessages,
            resumedConversation: Boolean(resumeConvId),
            includeWideToolsHint: mcpSync.attached,
            allowBrowser,
            toolMode,
          })
        : userText;

      return await antigravityDispatchTurn(worker, {
        promptText,
        images,
        root,
        send,
        signal,
      });
    };

    let outcome = await runAttempt(storedConvId);
    if (!outcome.ok && outcome.errorKind === "session_not_found" && !outcome.emittedAnything && storedConvId) {
      if (effectiveSid && typeof setAiSessionAntigravityMeta === "function") {
        await setAiSessionAntigravityMeta(effectiveSid, { conversationId: "" }).catch(() => {});
      }
      outcome = await runAttempt("");
    }

    if (!outcome.ok) {
      if (outcome.errorKind === "auth") {
        agyLastSignedIn = false;
      }
      send({
        type: "error",
        message: outcome.error || "Antigravity CLI execution failed.",
        ...(outcome.errorKind ? { errorKind: outcome.errorKind } : {}),
      });
      return { ok: false, error: outcome.error };
    }

    agyLastSignedIn = true;
    return {
      ok: true,
      text: outcome.text || "",
      conversationId: outcome.conversationId || storedConvId,
    };
  } finally {
    agyCurrentTurnCtx = prevCtx;
  }
}

async function aiRunSingleShotAntigravity({ binPath, prompt, model, effort, signal, timeoutMs }) {
  const args = __wideTs.buildAntigravityCliArgs({
    model,
    effort,
    mode: "ask",
  });
  const payload = __wideTs.serializeAntigravityStreamUserMessage(prompt);
  const res = await antigravityExecCapture(binPath, args, {
    stdinText: `${payload}\n`,
    signal,
    timeoutMs,
  });
  const parser = new __wideTs.AntigravityStreamEventParser();
  let text = "";
  let isError = !res.ok;
  let errMsg = res.stderr || "";
  for (const line of String(res.stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    for (const ev of parser.parseLine(line)) {
      if (ev.type === "delta") {
        text += ev.text;
      } else if (ev.type === "result") {
        if (ev.isError) {
          isError = true;
          errMsg = ev.text || errMsg;
        } else if (!text && ev.text) {
          text = ev.text;
        }
      }
    }
  }
  if (isError) {
    return { ok: false, text: "", error: errMsg.trim() || "Antigravity CLI execution failed." };
  }
  return { ok: true, text: text.trim() };
}

async function aiCompleteAntigravity({ prefix, suffix, language, signal }) {
  const binPath = await antigravityPath();
  if (!binPath) return { ok: false };
  const prompt = [
    `Complete the ${language || "code"} snippet cleanly. Output ONLY the inserted code without markdown fences or explanation.`,
    `PREFIX:\n${String(prefix || "").slice(-2500)}`,
    `SUFFIX:\n${String(suffix || "").slice(0, 1000)}`,
  ].join("\n\n");
  const res = await aiRunSingleShotAntigravity({
    binPath,
    prompt,
    effort: "low",
    signal,
    timeoutMs: AGY_COMPLETE_TIMEOUT_MS,
  });
  if (!res.ok || !res.text) return { ok: false };
  return { ok: true, completion: res.text };
}

async function aiCompactAntigravity({ model, messages, signal }) {
  const binPath = await antigravityPath();
  if (!binPath) return "";
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return "";
  const transcript = list
    .map((msg) => {
      const role = String(msg?.role || "user").toUpperCase();
      const text = Array.isArray(msg?.content)
        ? msg.content.filter((b) => b?.type === "text").map((b) => String(b.text || "")).join("\n")
        : String(msg?.content ?? "");
      return `${role}: ${text}`;
    })
    .join("\n\n")
    .slice(-36000);
  const prompt = [
    "Summarize the following technical conversation concisely, preserving file paths, exact symbol names, key decisions, and open tasks.",
    transcript,
  ].join("\n\n");
  const catalog = agyCachedModels && agyCachedModels.length > 0 ? agyCachedModels : __wideTs.DEFAULT_ANTIGRAVITY_MODELS;
  const resolvedModel = __wideTs.resolveAntigravityModelForEffort(model, "medium", catalog);
  const res = await aiRunSingleShotAntigravity({
    binPath,
    prompt,
    model: resolvedModel,
    effort: "low",
    signal,
    timeoutMs: AGY_COMPACT_TIMEOUT_MS,
  });
  return res.ok ? res.text : "";
}

function registerAntigravityHandlers() {
  electron.ipcMain.handle("ai:antigravityStatus", async (_event, opts = {}) => {
    return await antigravityReadStatus(opts || {});
  });

  electron.ipcMain.handle("ai:antigravityModels", async () => {
    const binPath = await antigravityPath();
    return await antigravityListModels(binPath);
  });

  electron.ipcMain.handle("ai:antigravityInstall", async () => {
    const res = await antigravityInstall();
    const status = await antigravityReadStatus({ force: true });
    return { ...res, status };
  });

  electron.ipcMain.handle("ai:antigravityLogin", async () => {
    const binPath = await antigravityPath();
    if (!binPath) {
      return { ok: false, error: "Antigravity CLI is not installed." };
    }
    return await antigravityOpenLoginTerminal(binPath);
  });

  electron.ipcMain.handle("ai:antigravityAttachMcp", async () => {
    const binPath = await antigravityPath();
    if (!binPath) {
      return { ok: false, error: "Antigravity CLI is not installed." };
    }
    const syncRes = await antigravitySyncWideMcpUrl(binPath, true);
    if (!syncRes.attached) {
      return { ok: false, error: syncRes.error || "Failed to attach Wide MCP server." };
    }
    antigravityStopAll();
    const status = await antigravityReadStatus({ force: true });
    return { ok: true, status };
  });

  electron.ipcMain.handle("ai:closeAntigravitySession", async (_event, id) => {
    return { ok: true, closed: aiCloseAntigravitySession(id) };
  });
}
