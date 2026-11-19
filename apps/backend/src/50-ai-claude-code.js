const CLAUDE_CODE_HOST = "127.0.0.1";
const CLAUDE_CODE_IDLE_TTL_MS = 15 * 60 * 1000;
const CLAUDE_CODE_NATIVE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
const CLAUDE_CODE_WORKERS = new Map();

function claudeCodeAppRoot() {
  return node_path.resolve(__dirname, "..", "..");
}

function claudeCodeSanitizedEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SSE_PORT;
  return env;
}

async function claudeCodeFileExists(targetPath) {
  if (!targetPath) return false;
  try {
    await promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function claudeCodeWhere(cmd) {
  const tool = process.platform === "win32" ? "where.exe" : "which";
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    try {
      const child = node_child_process.spawn(tool, [cmd], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish("");
      }, 3000);
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish("");
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          finish("");
          return;
        }
        const lines = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (process.platform === "win32") {
          const preferred =
            lines.find((l) => /\.(cmd|exe)$/i.test(l)) ||
            lines.find((l) => /\.(js|mjs|cjs)$/i.test(l)) ||
            lines[0] ||
            "";
          finish(preferred);
        } else {
          finish(lines[0] || "");
        }
      });
    } catch {
      finish("");
    }
  });
}

async function claudeCodePath() {
  const override = String(process.env.WIDE_CLAUDE_PATH || "").trim();
  if (override && (await claudeCodeFileExists(override))) {
    return override;
  }

  const home = node_os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          process.env.APPDATA ? node_path.join(process.env.APPDATA, "npm", "claude.cmd") : "",
          process.env.LOCALAPPDATA
            ? node_path.join(process.env.LOCALAPPDATA, "Programs", "claude", "claude.exe")
            : "",
          node_path.join(home, ".claude", "local", "claude.exe"),
          node_path.join(home, ".local", "bin", "claude.exe"),
        ]
      : [
          node_path.join(home, ".claude", "local", "claude"),
          node_path.join(home, ".local", "bin", "claude"),
          "/opt/homebrew/bin/claude",
          "/usr/local/bin/claude",
          "/usr/bin/claude",
        ];

  for (const candidate of candidates) {
    if (candidate && (await claudeCodeFileExists(candidate))) {
      return candidate;
    }
  }

  const fromWhere = await claudeCodeWhere(process.platform === "win32" ? "claude.cmd" : "claude");
  if (fromWhere && (await claudeCodeFileExists(fromWhere))) {
    return fromWhere;
  }
  if (process.platform === "win32") {
    const exeWhere = await claudeCodeWhere("claude.exe");
    if (exeWhere && (await claudeCodeFileExists(exeWhere))) {
      return exeWhere;
    }
  }
  return "";
}

function claudeCodeShimScript(exePath) {
  if (process.platform !== "win32") return "";
  if (!/\.(cmd|bat)$/i.test(exePath)) return "";
  try {
    const content = node_fs.readFileSync(exePath, "utf8");
    const match = /"%~dp0\\([^"\r\n]+\.(?:js|mjs|cjs))"/i.exec(content);
    if (!match) return "";
    const resolved = node_path.resolve(node_path.dirname(exePath), match[1]);
    if (node_fs.existsSync(resolved)) return resolved;
  } catch {}
  return "";
}

function claudeCodeBuildSpawnSpec(binPath, args) {
  if (/\.(js|mjs|cjs)$/i.test(binPath)) {
    return {
      command: process.execPath,
      args: [binPath, ...args],
      useShell: false,
      asNode: Boolean(process.versions.electron),
    };
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binPath)) {
    const script = claudeCodeShimScript(binPath);
    if (script) {
      return {
        command: process.execPath,
        args: [script, ...args],
        useShell: false,
        asNode: Boolean(process.versions.electron),
      };
    }
    return {
      command: binPath,
      args,
      useShell: true,
      asNode: false,
    };
  }
  return {
    command: binPath,
    args,
    useShell: false,
    asNode: false,
  };
}

async function claudeCodeExecCapture(binPath, args, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 10000;
  const spec = claudeCodeBuildSpawnSpec(binPath, args);
  const env = claudeCodeSanitizedEnv(spec.asNode ? { ELECTRON_RUN_AS_NODE: "1" } : {});

  return await new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    let child;
    try {
      child = node_child_process.spawn(spec.command, spec.args, {
        cwd: opts.cwd || process.cwd(),
        env,
        windowsHide: true,
        shell: spec.useShell,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error?.message || error), timedOut: false });
      return;
    }

    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: typeof code === "number" ? code : -1, stdout, stderr, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      done(-1);
    }, timeoutMs);

    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {}
      done(-1);
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      stderr += String(err?.message || err);
      done(-1);
    });
    child.on("close", (code) => {
      if (opts.signal) {
        opts.signal.removeEventListener("abort", onAbort);
      }
      done(code);
    });

    try {
      if (typeof opts.stdinText === "string") {
        child.stdin.write(opts.stdinText);
      }
      child.stdin.end();
    } catch {}
  });
}

async function rememberClaudeCode(signedIn) {
  const config = await readAiConfig();
  if (config.claudeCodeSignedIn === Boolean(signedIn)) return;
  await writeAiConfig({ ...config, claudeCodeSignedIn: Boolean(signedIn) });
}

async function claudeCodeReadAuthStatus(binPath) {
  const exe = binPath || (await claudeCodePath());
  if (!exe) {
    return {
      ok: true,
      installed: false,
      path: "",
      signedIn: false,
      loggedIn: false,
      authMethod: "",
      apiProvider: "",
      email: "",
      subscriptionType: "",
    };
  }

  const res = await claudeCodeExecCapture(exe, ["auth", "status", "--json"], { timeoutMs: 8000 });
  const parsed = __wideTs.parseClaudeAuthStatusJson(res.stdout);
  if (parsed) {
    await rememberClaudeCode(parsed.loggedIn);
    return {
      ok: true,
      installed: true,
      path: exe,
      signedIn: parsed.loggedIn,
      loggedIn: parsed.loggedIn,
      authMethod: parsed.authMethod,
      apiProvider: parsed.apiProvider,
      email: parsed.email,
      subscriptionType: parsed.subscriptionType,
    };
  }

  const config = await readAiConfig();
  const cached = config.claudeCodeSignedIn === true;
  return {
    ok: true,
    installed: true,
    path: exe,
    signedIn: cached,
    loggedIn: cached,
    authMethod: "",
    apiProvider: "",
    email: "",
    subscriptionType: "",
  };
}

async function claudeCodeInstall(track) {
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  return await new Promise((resolve) => {
    let settled = false;
    let output = "";
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    try {
      const child = node_child_process.spawn(
        npmBin,
        ["install", "-g", "@anthropic-ai/claude-code"],
        {
          windowsHide: true,
          shell: process.platform === "win32",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish({ ok: false, error: "Claude Code installation timed out." });
      }, 180000);

      const handleChunk = (chunk) => {
        const text = chunk.toString("utf8");
        output += text;
        if (typeof track === "function") track(text);
      };
      child.stdout.on("data", handleChunk);
      child.stderr.on("data", handleChunk);
      child.on("error", (err) => {
        clearTimeout(timer);
        finish({ ok: false, error: String(err?.message || err) });
      });
      child.on("close", async (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          finish({ ok: false, error: output.trim() || `npm install exited with code ${code}` });
          return;
        }
        const installedPath = await claudeCodePath();
        finish({ ok: Boolean(installedPath), path: installedPath });
      });
    } catch (err) {
      finish({ ok: false, error: String(err?.message || err) });
    }
  });
}

async function claudeCodeOpenLoginTerminal(binPath) {
  const quoted = `"${binPath.replace(/"/g, '\\"')}"`;
  if (process.platform === "win32") {
    const cmdLine =
      /\.(js|mjs|cjs)$/i.test(binPath)
        ? `"${process.execPath}" ${quoted} auth login`
        : `${quoted} auth login`;
    node_child_process.spawn(
      "cmd.exe",
      ["/c", "start", "Wide - Claude Code Sign In", "cmd.exe", "/k", cmdLine],
      { detached: true, windowsHide: false, stdio: "ignore" },
    ).unref();
    return { ok: true, started: true };
  }

  if (process.platform === "darwin") {
    const script = `tell application "Terminal" to do script "${binPath.replace(/"/g, '\\"')} auth login"`;
    node_child_process.spawn("osascript", ["-e", script], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return { ok: true, started: true };
  }

  const terms = [
    ["x-terminal-emulator", ["-e", `${quoted} auth login`]],
    ["gnome-terminal", ["--", "sh", "-c", `${quoted} auth login; read -r _`]],
    ["konsole", ["-e", "sh", "-c", `${quoted} auth login; read -r _`]],
    ["xterm", ["-e", "sh", "-c", `${quoted} auth login; read -r _`]],
  ];
  for (const [term, args] of terms) {
    try {
      const child = node_child_process.spawn(term, args, {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { ok: true, started: true };
    } catch {}
  }
  return { ok: false, error: "Could not find a desktop terminal emulator. Run `claude auth login` in your terminal." };
}

function claudeCodeCreateBridge(getTurnCtx) {
  const token = node_crypto.randomBytes(24).toString("hex");
  const sockets = new Set();

  const server = node_http.createServer((req, res) => {
    const offered = String(req.headers.authorization ?? "");
    if (offered !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const ctx = getTurnCtx();
    if (!ctx) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no_active_turn" }));
      return;
    }

    if (req.method === "GET" && req.url === "/tools") {
      const specs = __wideTs
        .aiFilterToolsForClaudeMcp(AI_TOOLS, {
          allowWrites: ctx.allowWrites,
          toolMode: ctx.toolMode,
          allowBrowser: ctx.allowBrowser,
        })
        .map((t) => ({
          name: String(t.name),
          description: String(t.description || ""),
          inputSchema:
            t.inputSchema && typeof t.inputSchema === "object"
              ? t.inputSchema
              : t.parameters && typeof t.parameters === "object"
                ? t.parameters
                : { type: "object", properties: {} },
        }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ tools: specs }));
      return;
    }

    if (req.method === "POST" && req.url === "/tool") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const toolName = String(parsed.name ?? "").trim();
          const args = parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {};
          const allowedSpecs = __wideTs.aiFilterToolsForClaudeMcp(AI_TOOLS, {
            allowWrites: ctx.allowWrites,
            toolMode: ctx.toolMode,
            allowBrowser: ctx.allowBrowser,
          });
          if (!allowedSpecs.some((spec) => spec.name === toolName)) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                result: `Tool "${toolName}" is unavailable in current mode or handled natively by Claude Code.`,
              }),
            );
            return;
          }
          const result = await aiRunTool(
            ctx.root,
            toolName,
            args,
            ctx.send,
            ctx.allowWrites,
            ctx.userPrompt,
            ctx.signal,
            ctx.turnContext,
          );
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ result: String(result ?? "") }));
        } catch (err) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String(err?.message || err) }));
        }
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, CLAUDE_CODE_HOST, () => {
      server.removeListener("error", reject);
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        token,
        close: () => {
          for (const socket of sockets) {
            try {
              socket.destroy();
            } catch {}
          }
          try {
            server.close();
          } catch {}
        },
      });
    });
  });
}

function claudeCodeExtractUserMessagePayload(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let lastUserIdx = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && list[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const lastMsg = lastUserIdx >= 0 ? list[lastUserIdx] : null;
  let text = "";
  const images = [];

  if (lastMsg) {
    if (typeof lastMsg.content === "string") {
      text = lastMsg.content;
    } else if (Array.isArray(lastMsg.content)) {
      const textParts = [];
      for (const block of lastMsg.content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
        } else if (block.type === "image" && block.source && typeof block.source.data === "string") {
          images.push({
            mediaType: block.source.media_type || "image/png",
            data: block.source.data,
          });
        }
      }
      text = textParts.join("\n");
    }
    if (Array.isArray(lastMsg.images)) {
      for (const img of lastMsg.images) {
        if (!img) continue;
        if (typeof img === "string") {
          images.push({ mediaType: "image/png", data: img });
        } else if (typeof img.data === "string") {
          images.push({ mediaType: img.mediaType || img.mime || img.media_type || "image/png", data: img.data });
        }
      }
    }
  }

  return { lastUserIdx, text, images, prior: lastUserIdx > 0 ? list.slice(0, lastUserIdx) : [] };
}

function claudeCodeFormatPriorHistory(priorMessages) {
  const lines = [];
  const slice = Array.isArray(priorMessages) ? priorMessages.slice(-24) : [];
  for (const msg of slice) {
    if (!msg) continue;
    const role = msg.role === "assistant" ? "Assistant" : "User";
    const text =
      typeof msg.content === "string"
        ? msg.content.trim()
        : Array.isArray(msg.content)
          ? msg.content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n").trim()
          : "";
    if (!text) continue;
    lines.push(`${role}: ${text.slice(0, 2000)}`);
  }
  if (lines.length === 0) return "";
  return `[Previous conversation context]\n${lines.join("\n\n")}\n[End of previous context]\n\n`;
}

function claudeCodeBuildAppendSystemPrompt({
  system,
  root,
  allowWrites,
  toolMode,
  allowBrowser,
  interactionMode,
  projectInstructions,
  language,
  activeFile,
  openTabs,
}) {
  const modeLabel = interactionMode === "ask" ? "Ask (read-only analysis)" : `Agent (${toolMode || "full"})`;
  const parts = [
    `You are running inside Wide IDE connected via Claude Code native runtime.`,
    `Workspace root: ${root || "(none)"}`,
    `Active mode: ${modeLabel}. Write permissions: ${allowWrites ? "enabled" : "read-only"}.`,
    `Use your native Claude Code tools (Read, Edit, Write, MultiEdit, Bash, Glob, Grep, Agent, TodoWrite, WebFetch, WebSearch) directly for all file, shell, and search tasks.`,
  ];

  const uniqueTools = __wideTs.aiFilterToolsForClaudeMcp(AI_TOOLS, {
    allowWrites,
    toolMode,
    allowBrowser,
  });
  if (uniqueTools.length > 0) {
    const toolNames = uniqueTools.map((t) => t.name).join(", ");
    parts.push(
      `Additional Wide IDE / Security / Browser / DB / LSP tools are attached on MCP server "wide": ${toolNames}.`,
    );
  }
  if (__wideTs?.aiBuildWideCapabilityPlaybook) {
    parts.push(
      __wideTs.aiBuildWideCapabilityPlaybook({
        toolMode,
        allowBrowser,
        allowWrites,
        isExternalCli: true,
      }),
    );
  }

  if (activeFile) {
    parts.push(`Currently focused editor file: ${activeFile}`);
  }
  if (Array.isArray(openTabs) && openTabs.length > 0) {
    const names = openTabs
      .map((t) => (t?.path ? node_path.basename(String(t.path)) : String(t?.name || "")))
      .filter(Boolean)
      .slice(0, 15);
    if (names.length > 0) {
      parts.push(`Open editor tabs: ${names.join(", ")}`);
    }
  }
  const lang = String(language || "").trim().toLowerCase();
  if (lang && lang !== "en") {
    parts.push(`Respond in language code "${lang}" unless code identifiers or technical terms require English.`);
  }
  if (projectInstructions && String(projectInstructions).trim()) {
    parts.push(`Project instructions (.wide/ai-instructions.md):\n${String(projectInstructions).trim()}`);
  }
  const customSystem = String(system || "").trim();
  if (customSystem && !customSystem.includes("# Wide IDE Autonomous")) {
    parts.push(customSystem.slice(0, 4000));
  }
  return parts.join("\n\n");
}

function claudeCodeWorkerSignature(opts) {
  return JSON.stringify([
    opts.root || "",
    opts.model || "",
    opts.fallbackModel || "",
    opts.effort || "",
    opts.interactionMode || "agent",
    opts.toolMode || "full",
    opts.allowBrowser !== false,
    opts.allowWrites !== false,
    opts.language || "",
  ]);
}

function claudeCodeDisposeWorker(worker) {
  if (!worker || worker.disposed) return;
  worker.disposed = true;
  if (worker.idleTimer) {
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
  }
  if (worker.key && CLAUDE_CODE_WORKERS.get(worker.key) === worker) {
    CLAUDE_CODE_WORKERS.delete(worker.key);
  }
  try {
    worker.proc.stdin.end();
  } catch {}
  try {
    worker.proc.kill("SIGKILL");
  } catch {}
  try {
    worker.bridge.close();
  } catch {}
  for (const tempFile of worker.tempFiles) {
    try {
      node_fs.unlinkSync(tempFile);
    } catch {}
  }
}

function aiCloseClaudeSession(sessionId) {
  const key = String(sessionId || "");
  if (!key) return;
  const worker = CLAUDE_CODE_WORKERS.get(key);
  if (worker) {
    claudeCodeDisposeWorker(worker);
  }
}

function claudeCodeStopAll() {
  for (const worker of Array.from(CLAUDE_CODE_WORKERS.values())) {
    claudeCodeDisposeWorker(worker);
  }
  CLAUDE_CODE_WORKERS.clear();
}

function claudeCodeTakePreEditSnapshot(root, input) {
  const filePath = typeof input?.file_path === "string" ? input.file_path : "";
  if (!root || !filePath) return null;
  const resolved = aiResolvePath(root, filePath);
  if (resolved.error) return null;
  let beforeContent = "";
  let existed = false;
  try {
    if (node_fs.existsSync(resolved.path)) {
      beforeContent = node_fs.readFileSync(resolved.path, "utf8");
      existed = true;
    }
  } catch {
    beforeContent = "";
  }
  return {
    path: resolved.path,
    relativePath: resolved.relative,
    beforeContent,
    existed,
  };
}

function claudeCodeSpawnWorker({
  workerKey,
  binPath,
  signature,
  root,
  claudeSessionId,
  resume,
  appendSystemPrompt,
  model,
  fallbackModel,
  effort,
  interactionMode,
  toolMode,
}) {
  const tempFiles = [];
  const stamp = `${Date.now()}-${node_crypto.randomBytes(6).toString("hex")}`;
  const promptFile = node_path.join(node_os.tmpdir(), `wide-cc-prompt-${stamp}.txt`);
  node_fs.writeFileSync(promptFile, appendSystemPrompt, "utf8");
  tempFiles.push(promptFile);

  const worker = {
    key: workerKey,
    signature,
    claudeSessionId,
    disposed: false,
    busy: false,
    idleTimer: null,
    currentTurn: null,
    tempFiles,
    bridge: null,
    proc: null,
    stdoutBuf: "",
    stderrChunks: [],
  };

  return (async () => {
    worker.bridge = await claudeCodeCreateBridge(() => worker.currentTurn);

    const mcpScript = node_path.join(claudeCodeAppRoot(), "sidecar", "ai-mcp.cjs");
    let mcpConfigPath = "";
    if (node_fs.existsSync(mcpScript)) {
      mcpConfigPath = node_path.join(node_os.tmpdir(), `wide-cc-mcp-${stamp}.json`);
      const mcpConfig = {
        mcpServers: {
          wide: {
            command: process.execPath,
            args: [mcpScript],
            env: {
              WIDE_AI_PORT: String(worker.bridge.port),
              WIDE_AI_TOKEN: worker.bridge.token,
              ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
            },
          },
        },
      };
      node_fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig), "utf8");
      tempFiles.push(mcpConfigPath);
    }

    const cliArgs = __wideTs.buildClaudeCliArgs({
      sessionId: resume ? undefined : claudeSessionId,
      resumeSessionId: resume ? claudeSessionId : undefined,
      appendSystemPromptFile: promptFile,
      mcpConfigPath,
      model,
      fallbackModel,
      effort,
      mode: interactionMode,
      toolMode,
    });

    const spec = claudeCodeBuildSpawnSpec(binPath, cliArgs);
    const env = claudeCodeSanitizedEnv(spec.asNode ? { ELECTRON_RUN_AS_NODE: "1" } : {});

    worker.proc = node_child_process.spawn(spec.command, spec.args, {
      cwd: root || process.cwd(),
      env,
      windowsHide: true,
      shell: spec.useShell,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const handleParsedEvent = async (ev, turn) => {
      if (!turn || turn.settled) return;

      if (ev.type === "session_init") {
        if (ev.sessionId) {
          worker.claudeSessionId = ev.sessionId;
          if (turn.sessionId) {
            setAiSessionClaudeMeta(turn.sessionId, { claudeSessionId: ev.sessionId }).catch(() => {});
          }
        }
        return;
      }

      if (ev.type === "delta") {
        if (!ev.parentToolUseId) {
          turn.send({ type: "text", text: ev.text });
        }
        return;
      }

      if (ev.type === "thinking") {
        if (!ev.parentToolUseId) {
          turn.send({ type: "thinking", text: ev.text });
        }
        return;
      }

      if (ev.type === "tool_start") {
        if (
          turn.allowWrites &&
          CLAUDE_CODE_NATIVE_EDIT_TOOLS.has(ev.tool) &&
          !turn.preEditSnapshots.has(ev.id)
        ) {
          const snap = claudeCodeTakePreEditSnapshot(turn.root, ev.input);
          if (snap) {
            turn.preEditSnapshots.set(ev.id, snap);
          }
        }
        turn.send({
          type: "tool_start",
          name: ev.tool,
          input: ev.input,
          ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}),
        });
        return;
      }

      if (ev.type === "tool_result") {
        const snap = !ev.isError ? turn.preEditSnapshots.get(ev.id) : null;
        if (snap) {
          turn.preEditSnapshots.delete(ev.id);
          let afterContent = "";
          try {
            afterContent = await promises.readFile(snap.path, "utf8");
          } catch {
            afterContent = "";
          }
          const counts = aiDiffCounts(snap.beforeContent, afterContent);
          turn.send({
            type: "edit",
            root: turn.root,
            path: snap.path,
            oldContent: snap.beforeContent,
            content: afterContent,
            existed: snap.existed,
            staged: false,
            added: counts.added,
            removed: counts.removed,
          });
          await aiVerifyEditedFile(
            turn.root,
            snap.path,
            snap.relativePath,
            afterContent,
            false,
            turn.send,
          );
        }
        turn.send({
          type: "tool_end",
          name: ev.tool,
          result: ev.output,
          ...(ev.isError ? { error: true } : {}),
          ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}),
        });
        return;
      }

      if (ev.type === "prompt_suggestion") {
        turn.send({ type: "prompt_suggestion", suggestions: ev.suggestions });
        return;
      }

      if (ev.type === "usage") {
        turn.send({
          type: "usage",
          input: ev.inputTokens,
          output: ev.outputTokens,
          total: ev.inputTokens + ev.outputTokens,
          cacheRead: ev.cacheReadTokens,
          cacheCreation: ev.cacheCreationTokens,
          costUsd: ev.totalCostUsd,
          durationMs: ev.durationMs,
        });
        return;
      }

      if (ev.type === "result") {
        await Promise.allSettled(turn.pendingVerifications);
        if (turn.settled) return;

        const finalSessionId = ev.sessionId || worker.claudeSessionId;
        if (finalSessionId) {
          worker.claudeSessionId = finalSessionId;
        }

        if (ev.isError) {
          if (
            turn.usedResume &&
            ev.errorKind === "session_not_found" &&
            !turn.parser.hasEmittedRootText()
          ) {
            turn.finish({ ok: false, retryFreshSession: true, error: ev.text || "Session not found" });
            return;
          }
          const msg = ev.text || turn.stderrChunks.join("").trim() || "Claude Code execution failed.";
          if (ev.errorKind === "auth") {
            await rememberClaudeCode(false);
          }
          turn.send({
            type: "error",
            message: msg,
            ...(ev.errorKind ? { errorKind: ev.errorKind } : {}),
          });
          turn.finish({ ok: false, error: msg, errorKind: ev.errorKind });
          return;
        }

        await rememberClaudeCode(true);
        if (!turn.parser.hasEmittedRootText() && ev.text) {
          turn.send({ type: "text", text: ev.text });
        }
        if (turn.sessionId) {
          await setAiSessionClaudeMeta(turn.sessionId, {
            claudeSessionId: worker.claudeSessionId,
            claudeSyncedCount: turn.nextSyncedCount,
          });
        }
        turn.finish({ ok: true });
      }
    };

    const flushLine = (line) => {
      const turn = worker.currentTurn;
      if (!turn || turn.settled) return;
      const events = turn.parser.parseLine(line);
      if (events.length === 0) return;
      for (const ev of events) {
        if (
          ev.type === "tool_start" &&
          turn.allowWrites &&
          CLAUDE_CODE_NATIVE_EDIT_TOOLS.has(ev.tool) &&
          !turn.preEditSnapshots.has(ev.id)
        ) {
          const snap = claudeCodeTakePreEditSnapshot(turn.root, ev.input);
          if (snap) {
            turn.preEditSnapshots.set(ev.id, snap);
          }
        }
      }
      turn.chain = turn.chain.then(async () => {
        for (const ev of events) {
          await handleParsedEvent(ev, turn);
        }
      });
    };

    worker.proc.stdout.on("data", (chunk) => {
      worker.stdoutBuf += chunk.toString("utf8");
      const lines = worker.stdoutBuf.split(/\r?\n/);
      worker.stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) flushLine(line);
      }
    });

    worker.proc.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (worker.currentTurn) {
        worker.currentTurn.stderrChunks.push(text);
      }
      worker.stderrChunks.push(text);
    });

    worker.proc.on("error", (err) => {
      const turn = worker.currentTurn;
      if (turn && !turn.settled) {
        turn.finish({ ok: false, error: String(err?.message || err) });
      }
      claudeCodeDisposeWorker(worker);
    });

    worker.proc.on("close", (code) => {
      if (worker.stdoutBuf.trim()) {
        flushLine(worker.stdoutBuf);
        worker.stdoutBuf = "";
      }
      const turn = worker.currentTurn;
      if (turn && !turn.settled) {
        turn.chain.finally(() => {
          if (turn.settled) return;
          const stderrText = turn.stderrChunks.join("").trim();
          const classified = __wideTs.classifyClaudeStreamError(stderrText);
          if (turn.usedResume && classified.kind === "session_not_found" && !turn.parser.hasEmittedRootText()) {
            turn.finish({ ok: false, retryFreshSession: true, error: stderrText });
            return;
          }
          const msg = stderrText || `Claude Code exited unexpectedly (code ${code ?? "unknown"}).`;
          turn.send({ type: "error", message: msg, errorKind: classified.kind });
          turn.finish({ ok: false, error: msg, errorKind: classified.kind });
        });
      }
      claudeCodeDisposeWorker(worker);
    });

    return worker;
  })();
}

function claudeCodeDispatchTurnToWorker(worker, {
  promptText,
  images,
  root,
  sessionId,
  allowWrites,
  toolMode,
  allowBrowser,
  turnContext,
  usedResume,
  nextSyncedCount,
  signal,
  send,
}) {
  if (worker.idleTimer) {
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
  }

  return new Promise((resolve) => {
    const parser = new __wideTs.ClaudeStreamEventParser();
    const turn = {
      root,
      sessionId,
      allowWrites,
      toolMode,
      allowBrowser,
      userPrompt: promptText,
      turnContext,
      usedResume,
      nextSyncedCount,
      signal,
      send,
      parser,
      preEditSnapshots: new Map(),
      pendingVerifications: [],
      stderrChunks: [],
      chain: Promise.resolve(),
      settled: false,
      finish: (result) => {
        if (turn.settled) return;
        turn.settled = true;
        worker.busy = false;
        worker.currentTurn = null;
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        if (!worker.disposed) {
          worker.idleTimer = setTimeout(() => {
            claudeCodeDisposeWorker(worker);
          }, CLAUDE_CODE_IDLE_TTL_MS);
        }
        resolve(result);
      },
    };

    const onAbort = () => {
      turn.finish({ ok: false, error: "stopped" });
      claudeCodeDisposeWorker(worker);
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    worker.busy = true;
    worker.currentTurn = turn;

    const line = __wideTs.serializeClaudeStreamUserMessage({ text: promptText, images });
    try {
      worker.proc.stdin.write(`${line}\n`);
    } catch (err) {
      turn.finish({ ok: false, error: String(err?.message || err) });
      claudeCodeDisposeWorker(worker);
    }
  });
}

async function aiRunClaudeCodeTurn({
  root,
  sessionId = "",
  model = "",
  fallbackModel = "",
  effort = "",
  system = "",
  messages = [],
  allowWrites = true,
  toolMode = "full",
  allowBrowser = true,
  interactionMode = "agent",
  projectInstructions = "",
  language = "",
  activeFile = "",
  openTabs = [],
  turnContext = null,
  signal = null,
  send,
}) {
  const binPath = await claudeCodePath();
  if (!binPath) {
    const msg = "Claude Code CLI is not installed. Open the model picker to install it or run: npm install -g @anthropic-ai/claude-code";
    send({ type: "error", message: msg, errorKind: "not_installed" });
    return { ok: false, error: msg };
  }

  const effectiveInteractionMode =
    interactionMode === "ask" || !allowWrites ? "ask" : "agent";
  const effectiveToolMode = __wideTs.aiNormalizeToolMode(toolMode);
  const config = await readAiConfig();
  const normalizedEffort = __wideTs.normalizeClaudeEffort(
    effort || config.claudeEffort || "high",
  );
  const normalizedModel = __wideTs.normalizeClaudeModelChoice(model);
  const normalizedFallback = __wideTs.normalizeClaudeModelChoice(
    fallbackModel || config.claudeFallbackModel || "",
  );
  let resolvedInstructions = String(projectInstructions || "");
  if (!resolvedInstructions && root && typeof aiReadProjectInstructions === "function") {
    try {
      const info = await aiReadProjectInstructions(root, true);
      if (info && info.exists && info.content) {
        resolvedInstructions = info.content;
      }
    } catch {}
  }

  const workerKey = sessionId ? String(sessionId) : "";
  const { text: lastUserText, images, prior } = claudeCodeExtractUserMessagePayload(messages);
  if (!lastUserText && images.length === 0) {
    return { ok: false, error: "Empty prompt." };
  }

  let meta = workerKey
    ? await getAiSessionClaudeMeta(workerKey)
    : { claudeSessionId: "", claudeSyncedCount: 0 };

  let historyRewound = false;
  if (meta.claudeSyncedCount > 0 && messages.length <= meta.claudeSyncedCount) {
    historyRewound = true;
    meta = { claudeSessionId: "", claudeSyncedCount: 0 };
    if (workerKey) {
      await setAiSessionClaudeMeta(workerKey, { claudeSessionId: "", claudeSyncedCount: 0 });
    }
    aiCloseClaudeSession(workerKey);
  }

  const sig = claudeCodeWorkerSignature({
    root,
    model: normalizedModel,
    fallbackModel: normalizedFallback,
    effort: normalizedEffort,
    interactionMode: effectiveInteractionMode,
    toolMode: effectiveToolMode,
    allowBrowser,
    allowWrites,
    language,
  });

  const appendSystemPrompt = claudeCodeBuildAppendSystemPrompt({
    system,
    root,
    allowWrites,
    toolMode: effectiveToolMode,
    allowBrowser,
    interactionMode: effectiveInteractionMode,
    projectInstructions: resolvedInstructions,
    language,
    activeFile,
    openTabs,
  });

  let existingWorker = workerKey ? CLAUDE_CODE_WORKERS.get(workerKey) : null;
  if (existingWorker && (existingWorker.disposed || existingWorker.busy || existingWorker.signature !== sig)) {
    claudeCodeDisposeWorker(existingWorker);
    existingWorker = null;
  }

  if (existingWorker && existingWorker.proc && existingWorker.proc.stdin.writable) {
    const res = await claudeCodeDispatchTurnToWorker(existingWorker, {
      promptText: lastUserText,
      images,
      root,
      sessionId: workerKey,
      allowWrites,
      toolMode: effectiveToolMode,
      allowBrowser,
      turnContext,
      usedResume: false,
      nextSyncedCount: messages.length,
      signal,
      send,
    });
    if (res.ok || res.error === "stopped") return res;
    claudeCodeDisposeWorker(existingWorker);
    return res;
  }

  const useResume = Boolean(meta.claudeSessionId && meta.claudeSyncedCount > 0 && !historyRewound);
  let targetClaudeId = useResume ? meta.claudeSessionId : node_crypto.randomUUID();
  let promptForFirstTurn = lastUserText;
  if (!useResume && prior.length > 0) {
    const prefix = claudeCodeFormatPriorHistory(prior);
    if (prefix) {
      promptForFirstTurn = `${prefix}${lastUserText}`;
    }
  }

  if (workerKey) {
    await setAiSessionClaudeMeta(workerKey, { claudeSessionId: targetClaudeId });
  }

  let worker = await claudeCodeSpawnWorker({
    workerKey,
    binPath,
    signature: sig,
    root,
    claudeSessionId: targetClaudeId,
    resume: useResume,
    appendSystemPrompt,
    model: normalizedModel,
    fallbackModel: normalizedFallback,
    effort: normalizedEffort,
    interactionMode: effectiveInteractionMode,
    toolMode: effectiveToolMode,
  });
  if (workerKey) {
    CLAUDE_CODE_WORKERS.set(workerKey, worker);
  }

  let res = await claudeCodeDispatchTurnToWorker(worker, {
    promptText: promptForFirstTurn,
    images,
    root,
    sessionId: workerKey,
    allowWrites,
    toolMode: effectiveToolMode,
    allowBrowser,
    turnContext,
    usedResume: useResume,
    nextSyncedCount: messages.length,
    signal,
    send,
  });

  if (!res.ok && res.retryFreshSession) {
    claudeCodeDisposeWorker(worker);
    targetClaudeId = node_crypto.randomUUID();
    const freshPrompt =
      prior.length > 0 ? `${claudeCodeFormatPriorHistory(prior)}${lastUserText}` : lastUserText;
    if (workerKey) {
      await setAiSessionClaudeMeta(workerKey, { claudeSessionId: targetClaudeId, claudeSyncedCount: 0 });
    }
    worker = await claudeCodeSpawnWorker({
      workerKey,
      binPath,
      signature: sig,
      root,
      claudeSessionId: targetClaudeId,
      resume: false,
      appendSystemPrompt,
      model: normalizedModel,
      fallbackModel: normalizedFallback,
      effort: normalizedEffort,
      interactionMode: effectiveInteractionMode,
      toolMode: effectiveToolMode,
    });
    if (workerKey) {
      CLAUDE_CODE_WORKERS.set(workerKey, worker);
    }
    res = await claudeCodeDispatchTurnToWorker(worker, {
      promptText: freshPrompt,
      images,
      root,
      sessionId: workerKey,
      allowWrites,
      toolMode: effectiveToolMode,
      allowBrowser,
      turnContext,
      usedResume: false,
      nextSyncedCount: messages.length,
      signal,
      send,
    });
  }

  if (!workerKey) {
    claudeCodeDisposeWorker(worker);
  }
  return res;
}

async function aiCompleteClaudeCode({ prefix, suffix, language, signal }) {
  const binPath = await claudeCodePath();
  if (!binPath) return { ok: false, error: "Claude Code is not installed." };
  const prompt = [
    `Complete the code snippet at <CURSOR>. Output ONLY the completion text to insert at <CURSOR> without markdown fences or explanations.`,
    language ? `Language: ${language}` : "",
    `${String(prefix || "").slice(-2500)}<CURSOR>${String(suffix || "").slice(0, 1000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await claudeCodeExecCapture(
    binPath,
    ["--print", "--output-format", "text", "--model", "haiku", "--tools", "", "--no-session-persistence"],
    { stdinText: prompt, timeoutMs: 10000, signal },
  );
  if (res.code !== 0) {
    return { ok: false, error: res.stderr.trim() || "Claude Code completion failed." };
  }
  const completion = res.stdout.replace(/^```[\w-]*\n?/, "").replace(/\n?```\s*$/, "");
  return { ok: true, completion };
}

async function aiCompactClaudeCode({ sessionId, model, messages, signal }) {
  const binPath = await claudeCodePath();
  if (!binPath) return null;
  const list = Array.isArray(messages) ? messages : [];
  if (list.length < 4) return null;

  const transcript = list
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${String(m.content || "").slice(0, 3000)}`)
    .join("\n\n")
    .slice(0, 40000);
  const prompt = [
    "Summarize the conversation so far into a dense, accurate technical handoff note preserving all file paths, architectural decisions, open bugs, completed edits, and pending steps:",
    transcript,
  ].join("\n\n");

  const chosenModel = __wideTs.normalizeClaudeModelChoice(model) || "sonnet";
  const res = await claudeCodeExecCapture(
    binPath,
    ["--print", "--output-format", "text", "--model", chosenModel, "--tools", "", "--no-session-persistence"],
    { stdinText: prompt, timeoutMs: 45000, signal },
  );
  if (res.code !== 0 || !res.stdout.trim()) return null;

  if (sessionId) {
    aiCloseClaudeSession(sessionId);
    await setAiSessionClaudeMeta(sessionId, { claudeSessionId: "", claudeSyncedCount: 0 });
  }
  return res.stdout.trim();
}

function registerClaudeCodeHandlers() {
  electron.ipcMain.handle("ai:claudeCodeStatus", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return await claudeCodeReadAuthStatus("");
  });

  electron.ipcMain.handle("ai:claudeCodeInstall", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return await claudeCodeInstall(null);
  });

  electron.ipcMain.handle("ai:claudeCodeLogin", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const binPath = await claudeCodePath();
    if (!binPath) return { ok: false, error: "Claude Code is not installed yet." };
    const status = await claudeCodeReadAuthStatus(binPath);
    if (status.signedIn) {
      return { ok: true, signedIn: true, alreadySignedIn: true, ...status };
    }
    return await claudeCodeOpenLoginTerminal(binPath);
  });

  electron.ipcMain.handle("ai:claudeCodeLogout", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const binPath = await claudeCodePath();
    claudeCodeStopAll();
    if (binPath) {
      await claudeCodeExecCapture(binPath, ["auth", "logout"], { timeoutMs: 8000 });
    }
    await rememberClaudeCode(false);
    return { ok: true, signedIn: false, loggedIn: false };
  });

  electron.ipcMain.handle("ai:closeClaudeSession", async (_event, id) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    aiCloseClaudeSession(id);
    return { ok: true };
  });
}
