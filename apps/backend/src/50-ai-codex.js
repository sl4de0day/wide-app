const CODEX_HOST = "127.0.0.1";
const CODEX_IDLE_TTL_MS = 15 * 60 * 1000;
const CODEX_RPC_TIMEOUT_MS = 12000;
const CODEX_INSTALL_TIMEOUT_MS = 180000;
const CODEX_COMPLETE_TIMEOUT_MS = 15000;
const CODEX_COMPACT_TIMEOUT_MS = 45000;
const CODEX_WORKERS = new Map();

let codexCachedModels = null;
let codexLastStatus = null;

function codexSanitizedEnv(extra = {}) {
  return { ...__wideTs.sanitizeCodexEnv(process.env), ...extra };
}

async function codexFileExists(targetPath) {
  if (!targetPath) return false;
  try {
    const st = await promises.stat(targetPath);
    return st.isFile();
  } catch {
    return false;
  }
}

async function codexWhere(cmd) {
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

async function codexPath() {
  const override = String(process.env.WIDE_CODEX_PATH || "").trim();
  if (override && (await codexFileExists(override))) {
    return override;
  }

  const home = node_os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          process.env.APPDATA ? node_path.join(process.env.APPDATA, "npm", "codex.cmd") : "",
          process.env.APPDATA ? node_path.join(process.env.APPDATA, "npm", "codex.exe") : "",
          process.env.LOCALAPPDATA
            ? node_path.join(process.env.LOCALAPPDATA, "Programs", "codex", "codex.exe")
            : "",
          node_path.join(home, ".codex", "bin", "codex.exe"),
          node_path.join(home, ".local", "bin", "codex.exe"),
        ]
      : [
          node_path.join(home, ".local", "bin", "codex"),
          node_path.join(home, ".codex", "bin", "codex"),
          "/opt/homebrew/bin/codex",
          "/usr/local/bin/codex",
          "/usr/bin/codex",
        ];

  for (const candidate of candidates) {
    if (candidate && (await codexFileExists(candidate))) {
      return candidate;
    }
  }

  const fromWhere = await codexWhere(process.platform === "win32" ? "codex.cmd" : "codex");
  if (fromWhere && (await codexFileExists(fromWhere))) {
    return fromWhere;
  }
  if (process.platform === "win32") {
    const exeWhere = await codexWhere("codex.exe");
    if (exeWhere && (await codexFileExists(exeWhere))) {
      return exeWhere;
    }
  }
  return "";
}

function codexShimScript(exePath) {
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

function codexBuildSpawnSpec(binPath, args) {
  if (/\.(js|mjs|cjs)$/i.test(binPath)) {
    return {
      command: process.execPath,
      args: [binPath, ...args],
      useShell: false,
      asNode: Boolean(process.versions.electron),
    };
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binPath)) {
    const script = codexShimScript(binPath);
    if (script) {
      return {
        command: process.execPath,
        args: [script, ...args],
        useShell: false,
        asNode: Boolean(process.versions.electron),
      };
    }
    return {
      command: "cmd.exe",
      args: ["/d", "/c", binPath, ...args],
      useShell: false,
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

async function codexExecCapture(binPath, args, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 8000;
  const spec = codexBuildSpawnSpec(binPath, args);
  const env = codexSanitizedEnv(spec.asNode ? { ELECTRON_RUN_AS_NODE: "1" } : {});

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
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error?.message || error), timedOut: false });
      return;
    }

    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
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

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      stderr += String(err?.message || err);
      done(-1);
    });
    child.on("close", (code) => done(code));
  });
}

function codexCreateRpcTransport(proc) {
  let nextId = 1;
  let stdoutBuf = "";
  const pending = new Map();
  const notificationHandlers = new Set();

  const rejectAll = (err) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    pending.clear();
  };

  const writeLine = (payload) => {
    if (!proc.stdin || !proc.stdin.writable) {
      throw new Error("Codex app-server stdin is closed.");
    }
    proc.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  const handleLine = (raw) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.id !== undefined && msg.id !== null && typeof msg.method !== "string") {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        const errMsg = typeof msg.error === "object" ? msg.error.message || JSON.stringify(msg.error) : String(msg.error);
        entry.reject(new Error(errMsg));
      } else {
        entry.resolve(msg.result ?? {});
      }
      return;
    }

    if (typeof msg.method === "string") {
      for (const handler of notificationHandlers) {
        handler(msg);
      }
    }
  };

  proc.stdout?.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf8");
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) handleLine(line);
    }
  });

  const flushRemaining = () => {
    if (stdoutBuf.trim()) {
      handleLine(stdoutBuf);
      stdoutBuf = "";
    }
  };

  const call = (method, params = {}, timeoutMs = CODEX_RPC_TIMEOUT_MS) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex RPC "${method}" timed out.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        writeLine({ jsonrpc: "2.0", id, method, params });
      } catch (err) {
        pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  };

  const notify = (method, params = {}) => {
    try {
      writeLine({ jsonrpc: "2.0", method, params });
    } catch {}
  };

  const reply = (id, result) => {
    try {
      writeLine({ jsonrpc: "2.0", id, result });
    } catch {}
  };

  const initialize = async (timeoutMs = CODEX_RPC_TIMEOUT_MS) => {
    await call(
      "initialize",
      {
        clientInfo: { name: "wide", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      },
      timeoutMs,
    );
    notify("initialized", {});
  };

  const onMessage = (handler) => {
    notificationHandlers.add(handler);
    return () => notificationHandlers.delete(handler);
  };

  return {
    call,
    notify,
    reply,
    initialize,
    onMessage,
    flushRemaining,
    rejectAll,
  };
}

async function codexRpcExchange(binPath, fn, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : CODEX_RPC_TIMEOUT_MS;
  const spec = codexBuildSpawnSpec(binPath, __wideTs.buildCodexAppServerArgs());
  const env = codexSanitizedEnv(spec.asNode ? { ELECTRON_RUN_AS_NODE: "1" } : {});

  const child = node_child_process.spawn(spec.command, spec.args, {
    cwd: opts.cwd || process.cwd(),
    env,
    windowsHide: true,
    shell: spec.useShell,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const rpc = codexCreateRpcTransport(child);
  let stderr = "";
  let settled = false;
  let timer = null;

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    try {
      child.stdin?.end();
    } catch {}
    try {
      child.kill("SIGKILL");
    } catch {}
  };

  const onAbort = () => {
    const err = new Error("Aborted");
    settled = true;
    rpc.rejectAll(err);
    cleanup();
  };
  if (opts.signal) {
    if (opts.signal.aborted) {
      cleanup();
      throw new Error("Aborted");
    }
    opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const failEarly = (err) => {
    if (settled) return;
    settled = true;
    rpc.rejectAll(err);
  };
  child.on("error", (err) => failEarly(err));
  child.on("close", (code) => {
    rpc.flushRemaining();
    if (!settled) {
      failEarly(new Error(stderr.trim() || `Codex app-server exited (code ${code ?? "unknown"}).`));
    }
  });

  try {
    const res = await Promise.race([
      (async () => {
        await rpc.initialize(timeoutMs);
        return await fn(rpc, child);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Codex app-server request timed out.")), timeoutMs);
      }),
    ]);
    settled = true;
    return res;
  } finally {
    cleanup();
  }
}

async function codexReadStatus(opts = {}) {
  const force = Boolean(opts?.force);
  const binPath = await codexPath();
  if (!binPath) {
    codexLastStatus = {
      ok: true,
      installed: false,
      path: "",
      signedIn: false,
      version: "",
      email: "",
      planType: "",
      models: [],
    };
    return codexLastStatus;
  }

  let version = "";
  try {
    const verRes = await codexExecCapture(binPath, ["--version"], { timeoutMs: 5000 });
    if (verRes.code === 0 && verRes.stdout.trim()) {
      version = verRes.stdout.trim().split(/\r?\n/)[0].trim();
    }
  } catch {}

  try {
    const rpcRes = await codexRpcExchange(
      binPath,
      async (rpc) => {
        const account = await rpc.call("account/read", { refreshToken: force }, 8000);
        const modelsRaw = await rpc.call("model/list", {}, 8000);
        return { account, modelsRaw };
      },
      { timeoutMs: 12000 },
    );
    const parsedAccount = __wideTs.parseCodexAccountResult(rpcRes.account);
    const parsedModels = __wideTs.normalizeCodexModelsResponse(rpcRes.modelsRaw);
    if (parsedModels.length > 0) {
      codexCachedModels = parsedModels;
    }
    codexLastStatus = {
      ok: true,
      installed: true,
      path: binPath,
      signedIn: parsedAccount.signedIn,
      version,
      email: parsedAccount.email,
      planType: parsedAccount.planType,
      models: codexCachedModels || [...__wideTs.DEFAULT_CODEX_MODELS],
    };
    return codexLastStatus;
  } catch {
    return {
      ok: true,
      installed: true,
      path: binPath,
      signedIn: false,
      version,
      email: "",
      planType: "",
      models: codexCachedModels || [...__wideTs.DEFAULT_CODEX_MODELS],
    };
  }
}

async function codexListModels(binPath) {
  const exe = binPath || (await codexPath());
  if (!exe) {
    return {
      ok: false,
      models: codexCachedModels || [...__wideTs.DEFAULT_CODEX_MODELS],
      error: "Codex CLI is not installed.",
    };
  }
  try {
    const raw = await codexRpcExchange(exe, (rpc) => rpc.call("model/list", {}, 8000), {
      timeoutMs: 10000,
    });
    const parsed = __wideTs.normalizeCodexModelsResponse(raw);
    if (parsed.length > 0) {
      codexCachedModels = parsed;
      return { ok: true, models: parsed };
    }
  } catch (err) {
    return {
      ok: false,
      models: codexCachedModels || [...__wideTs.DEFAULT_CODEX_MODELS],
      error: String(err?.message || err),
    };
  }
  return {
    ok: true,
    models: codexCachedModels || [...__wideTs.DEFAULT_CODEX_MODELS],
  };
}

async function codexInstall(track) {
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
      const child = node_child_process.spawn(npmBin, ["install", "-g", "@openai/codex"], {
        windowsHide: true,
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish({ ok: false, output, error: "Codex CLI installation timed out." });
      }, CODEX_INSTALL_TIMEOUT_MS);

      const handleChunk = (chunk) => {
        const text = chunk.toString("utf8");
        output += text;
        if (typeof track === "function") track(text);
      };
      child.stdout?.on("data", handleChunk);
      child.stderr?.on("data", handleChunk);
      child.on("error", (err) => {
        clearTimeout(timer);
        finish({ ok: false, output, error: String(err?.message || err) });
      });
      child.on("close", async (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          finish({ ok: false, output, error: output.trim() || `npm install exited with code ${code}` });
          return;
        }
        const status = await codexReadStatus({ force: true });
        finish({ ok: Boolean(status.installed), output, status });
      });
    } catch (err) {
      finish({ ok: false, output, error: String(err?.message || err) });
    }
  });
}

async function codexOpenLoginTerminal(binPath) {
  const quoted = `"${binPath.replace(/"/g, '\\"')}"`;
  const env = codexSanitizedEnv();
  if (process.platform === "win32") {
    const cmdLine = /\.(js|mjs|cjs)$/i.test(binPath)
      ? `"${process.execPath}" ${quoted} login`
      : `${quoted} login`;
    node_child_process
      .spawn("cmd.exe", ["/c", "start", "Wide - OpenAI Codex Sign In", "cmd.exe", "/k", cmdLine], {
        detached: true,
        windowsHide: false,
        env,
        stdio: "ignore",
      })
      .unref();
    return { ok: true, started: true };
  }

  if (process.platform === "darwin") {
    const script = `tell application "Terminal" to do script "${binPath.replace(/"/g, '\\"')} login"`;
    node_child_process
      .spawn("osascript", ["-e", script], {
        detached: true,
        env,
        stdio: "ignore",
      })
      .unref();
    return { ok: true, started: true };
  }

  const terms = [
    ["x-terminal-emulator", ["-e", `${quoted} login`]],
    ["gnome-terminal", ["--", "sh", "-c", `${quoted} login; read -r _`]],
    ["konsole", ["-e", "sh", "-c", `${quoted} login; read -r _`]],
    ["xterm", ["-e", "sh", "-c", `${quoted} login; read -r _`]],
  ];
  for (const [term, args] of terms) {
    try {
      const child = node_child_process.spawn(term, args, {
        detached: true,
        env,
        stdio: "ignore",
      });
      child.unref();
      return { ok: true, started: true };
    } catch {}
  }
  return { ok: false, error: "Could not find a desktop terminal emulator. Run `codex login` in your terminal." };
}

function codexCreateBridge(getMcpContext) {
  const token = node_crypto.randomBytes(24).toString("hex");
  const sockets = new Set();

  const sendJson = (res, status, payload) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  const server = node_http.createServer((req, res) => {
    const offered = String(req.headers.authorization ?? "");
    if (offered !== `Bearer ${token}`) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    const reqPath = String(req.url || "/").split("?")[0];
    if (reqPath !== "/mcp") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (req.method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST, DELETE" });
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", async () => {
      let parsed;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }

      const id = parsed.id;
      const method = String(parsed.method || "");
      const params = parsed.params && typeof parsed.params === "object" ? parsed.params : {};
      const hasId = id !== undefined && id !== null;

      if (!hasId || method.startsWith("notifications/")) {
        res.writeHead(202);
        res.end();
        return;
      }

      if (method === "initialize") {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: String(params.protocolVersion || "2025-03-26"),
            capabilities: { tools: {} },
            serverInfo: { name: "wide", version: "2.0.0" },
          },
        });
        return;
      }

      if (method === "ping") {
        sendJson(res, 200, { jsonrpc: "2.0", id, result: {} });
        return;
      }

      const ctx = getMcpContext();
      if (!ctx) {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "No active Wide session context" },
        });
        return;
      }

      if (method === "tools/list") {
        const specs = __wideTs.aiFilterToolsForClaudeMcp(AI_TOOLS, {
          allowWrites: ctx.allowWrites,
          toolMode: ctx.toolMode,
          allowBrowser: ctx.allowBrowser,
        });
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            tools: specs.map((t) => ({
              name: String(t.name),
              description: String(t.description || ""),
              inputSchema:
                t.inputSchema && typeof t.inputSchema === "object"
                  ? t.inputSchema
                  : t.parameters && typeof t.parameters === "object"
                    ? t.parameters
                    : { type: "object", properties: {} },
            })),
          },
        });
        return;
      }

      if (method === "tools/call") {
        if (!ctx.hasActiveTurn) {
          sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: "No active Wide AI turn." }],
              isError: true,
            },
          });
          return;
        }
        const toolName = String(params.name || "").trim();
        const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
        const allowedSpecs = __wideTs.aiFilterToolsForClaudeMcp(AI_TOOLS, {
          allowWrites: ctx.allowWrites,
          toolMode: ctx.toolMode,
          allowBrowser: ctx.allowBrowser,
        });
        if (!allowedSpecs.some((spec) => spec.name === toolName)) {
          sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `Tool "${toolName}" is unavailable in current mode or handled natively by Codex.`,
                },
              ],
              isError: false,
            },
          });
          return;
        }
        try {
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
          sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: String(result ?? "") }],
              isError: false,
            },
          });
        } catch (err) {
          sendJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: String(err?.message || err) }],
              isError: true,
            },
          });
        }
        return;
      }

      sendJson(res, 200, {
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

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, CODEX_HOST, () => {
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

function codexBuildDeveloperInstructions({
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
    `You are running inside Wide IDE connected via OpenAI Codex runtime.`,
    `Workspace root: ${root || "(none)"}`,
    `Active mode: ${modeLabel}. Write permissions: ${allowWrites ? "enabled" : "read-only"}.`,
    `Use your native Codex tools (file inspection, file editing, shell execution) directly for workspace file and command tasks.`,
  ];

  const uniqueTools = __wideTs.aiFilterToolsForClaudeMcp(AI_TOOLS, {
    allowWrites,
    toolMode,
    allowBrowser,
  });
  if (uniqueTools.length > 0) {
    parts.push(
      `Additional Wide IDE / Security / Browser / DB / LSP tools are attached on MCP server "wide": ${uniqueTools.map((t) => t.name).join(", ")}.`,
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

function codexWorkerSignature(opts) {
  return JSON.stringify([
    opts.root || "",
    opts.model || "",
    opts.interactionMode || "agent",
    opts.toolMode || "full",
    opts.allowBrowser !== false,
    opts.allowWrites !== false,
    opts.language || "",
  ]);
}

function codexDisposeWorker(worker) {
  if (!worker || worker.disposed) return;
  worker.disposed = true;
  if (worker.idleTimer) {
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
  }
  if (worker.key && CODEX_WORKERS.get(worker.key) === worker) {
    CODEX_WORKERS.delete(worker.key);
  }
  if (worker.rpc) {
    worker.rpc.rejectAll(new Error("Codex worker disposed."));
  }
  try {
    worker.proc?.stdin?.end();
  } catch {}
  try {
    worker.proc?.kill("SIGKILL");
  } catch {}
  try {
    worker.bridge?.close();
  } catch {}
}

function aiCloseCodexSession(sessionId) {
  const key = String(sessionId || "");
  if (!key) return;
  const worker = CODEX_WORKERS.get(key);
  if (worker) {
    codexDisposeWorker(worker);
  }
}

function codexStopAll() {
  for (const worker of Array.from(CODEX_WORKERS.values())) {
    codexDisposeWorker(worker);
  }
  CODEX_WORKERS.clear();
}

function codexTakePreEditSnapshots(root, input) {
  const changes = Array.isArray(input?.changes) ? input.changes : [];
  if (!root || changes.length === 0) return null;
  const snapshots = new Map();
  for (const ch of changes) {
    const rawPath = typeof ch?.path === "string" ? ch.path : "";
    if (!rawPath) continue;
    const resolved = aiResolvePath(root, rawPath);
    if (resolved.error) continue;
    if (snapshots.has(resolved.path)) continue;
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
    snapshots.set(resolved.path, {
      path: resolved.path,
      relativePath: resolved.relative,
      beforeContent,
      existed,
    });
  }
  return snapshots.size > 0 ? snapshots : null;
}

function codexImageExtension(mediaType) {
  const clean = String(mediaType || "").toLowerCase();
  if (clean.includes("jpeg") || clean.includes("jpg")) return ".jpg";
  if (clean.includes("webp")) return ".webp";
  if (clean.includes("gif")) return ".gif";
  return ".png";
}

function codexWriteTempImages(images) {
  const paths = [];
  if (!Array.isArray(images) || images.length === 0) return paths;
  for (const img of images) {
    if (!img || typeof img.data !== "string") continue;
    const b64 = img.data.replace(/^data:[^;]+;base64,/, "");
    if (!b64) continue;
    const filePath = node_path.join(
      node_os.tmpdir(),
      `wide-codex-img-${Date.now()}-${node_crypto.randomBytes(6).toString("hex")}${codexImageExtension(img.mediaType)}`,
    );
    try {
      node_fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
      paths.push(filePath);
    } catch {}
  }
  return paths;
}

function codexDeleteFiles(paths) {
  for (const p of paths) {
    try {
      node_fs.unlinkSync(p);
    } catch {}
  }
}

async function codexSpawnWorker({
  workerKey,
  binPath,
  signature,
  root,
  model,
  developerInstructions,
  interactionMode,
  toolMode,
  allowBrowser,
  allowWrites,
}) {
  const worker = {
    key: workerKey,
    signature,
    root,
    model,
    developerInstructions,
    interactionMode,
    toolMode,
    allowBrowser,
    allowWrites,
    threadId: "",
    activeTurnId: "",
    disposed: false,
    busy: false,
    idleTimer: null,
    currentTurn: null,
    stderrChunks: [],
    bridge: null,
    proc: null,
    rpc: null,
  };

  worker.bridge = await codexCreateBridge(() => {
    const turn = worker.currentTurn;
    if (turn) {
      return {
        hasActiveTurn: true,
        root: turn.root,
        send: turn.send,
        allowWrites: turn.allowWrites,
        toolMode: turn.toolMode,
        allowBrowser: turn.allowBrowser,
        userPrompt: turn.userPrompt,
        signal: turn.signal,
        turnContext: turn.turnContext,
      };
    }
    return {
      hasActiveTurn: false,
      root: worker.root,
      allowWrites: worker.allowWrites,
      toolMode: worker.toolMode,
      allowBrowser: worker.allowBrowser,
    };
  });

  const args = __wideTs.buildCodexAppServerArgs({
    mcpUrl: `http://${CODEX_HOST}:${worker.bridge.port}/mcp`,
    bearerEnvVar: "WIDE_CODEX_MCP_TOKEN",
  });
  const spec = codexBuildSpawnSpec(binPath, args);
  const env = codexSanitizedEnv({
    WIDE_CODEX_MCP_TOKEN: worker.bridge.token,
    ...(spec.asNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  });

  worker.proc = node_child_process.spawn(spec.command, spec.args, {
    cwd: root || process.cwd(),
    env,
    windowsHide: true,
    shell: spec.useShell,
    stdio: ["pipe", "pipe", "pipe"],
  });

  worker.rpc = codexCreateRpcTransport(worker.proc);

  const handleParsedEvent = async (ev, turn) => {
    if (!turn || turn.settled) return;

    if (ev.type === "delta") {
      turn.hasText = true;
      turn.fullText += ev.text;
      turn.send({ type: "text", text: ev.text });
      return;
    }

    if (ev.type === "thinking") {
      turn.send({ type: "thinking", text: ev.text });
      return;
    }

    if (ev.type === "tool_start") {
      if (turn.allowWrites && ev.tool === "fileChange" && !turn.preEditSnapshots.has(ev.id)) {
        const snapMap = codexTakePreEditSnapshots(turn.root, ev.input);
        if (snapMap) {
          turn.preEditSnapshots.set(ev.id, snapMap);
        }
      }
      turn.send({
        type: "tool_start",
        name: ev.tool,
        input: ev.input,
      });
      return;
    }

    if (ev.type === "tool_result") {
      const snapMap = !ev.isError && ev.tool === "fileChange" ? turn.preEditSnapshots.get(ev.id) : null;
      turn.preEditSnapshots.delete(ev.id);
      if (ev.tool === "fileChange" && !ev.isError && turn.allowWrites && turn.root) {
        const rawChanges = Array.isArray(ev.changes) ? ev.changes : [];
        const targetPaths = [];
        for (const ch of rawChanges) {
          if (ch && typeof ch.path === "string" && ch.path) targetPaths.push(ch.path);
        }
        if (targetPaths.length === 0 && snapMap) {
          for (const key of snapMap.keys()) targetPaths.push(key);
        }
        const seenResolved = new Set();
        for (const candidatePath of targetPaths) {
          const resolved = aiResolvePath(turn.root, candidatePath);
          if (resolved.error || seenResolved.has(resolved.path)) continue;
          seenResolved.add(resolved.path);
          const snap = snapMap ? snapMap.get(resolved.path) : null;
          const beforeContent = snap ? snap.beforeContent : "";
          const existed = snap ? snap.existed : false;
          let afterContent = "";
          try {
            afterContent = await promises.readFile(resolved.path, "utf8");
          } catch {
            afterContent = "";
          }
          const counts = aiDiffCounts(beforeContent, afterContent);
          turn.send({
            type: "edit",
            root: turn.root,
            path: resolved.path,
            oldContent: beforeContent,
            content: afterContent,
            existed,
            staged: false,
            added: counts.added,
            removed: counts.removed,
          });
          await aiVerifyEditedFile(
            turn.root,
            resolved.path,
            resolved.relative,
            afterContent,
            false,
            turn.send,
          );
        }
      }
      turn.send({
        type: "tool_end",
        name: ev.tool,
        result: ev.output,
        ...(ev.isError ? { error: true } : {}),
      });
      return;
    }

    if (ev.type === "usage") {
      turn.send({
        type: "usage",
        input: ev.inputTokens,
        output: ev.outputTokens,
        total: ev.inputTokens + ev.outputTokens,
        cacheRead: ev.cacheReadTokens || 0,
        reasoning: ev.reasoningTokens || 0,
      });
      return;
    }

    if (ev.type === "turn_done") {
      if (ev.isError) {
        const msg = ev.message || turn.stderrChunks.join("").trim() || "Codex execution failed.";
        if (
          turn.usedResume &&
          ev.errorKind === "session_not_found" &&
          !turn.hasText
        ) {
          turn.finish({ ok: false, retryFreshSession: true, error: msg });
          return;
        }
        if (ev.errorKind === "auth") {
          codexLastStatus = null;
        }
        turn.finish({ ok: false, error: msg, errorKind: ev.errorKind });
        return;
      }

      if (turn.sessionId && worker.threadId) {
        await setAiSessionCodexMeta(turn.sessionId, {
          codexThreadId: worker.threadId,
          codexSyncedCount: turn.nextSyncedCount,
        });
      }
      turn.finish({ ok: true, text: turn.fullText, threadId: worker.threadId });
    }
  };

  worker.rpc.onMessage((msg) => {
    if (msg.id !== undefined && msg.id !== null) {
      if (String(msg.method || "").includes("requestApproval")) {
        worker.rpc.reply(msg.id, {
          decision: worker.allowWrites ? "accept" : "decline",
        });
      } else {
        worker.rpc.reply(msg.id, {});
      }
      return;
    }

    const turn = worker.currentTurn;
    if (!turn || turn.settled) return;

    if (msg.method === "turn/started" && msg.params?.turn?.id) {
      worker.activeTurnId = String(msg.params.turn.id);
    }

    const events = turn.parser.feedNotification(msg.method, msg.params || {});
    if (events.length === 0) return;
    for (const ev of events) {
      if (ev.type === "tool_start" && turn.allowWrites && ev.tool === "fileChange" && !turn.preEditSnapshots.has(ev.id)) {
        const snapMap = codexTakePreEditSnapshots(turn.root, ev.input);
        if (snapMap) {
          turn.preEditSnapshots.set(ev.id, snapMap);
        }
      }
    }
    turn.chain = turn.chain.then(async () => {
      for (const ev of events) {
        await handleParsedEvent(ev, turn);
      }
    });
  });

  worker.proc.stderr?.on("data", (chunk) => {
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
    codexDisposeWorker(worker);
  });

  worker.proc.on("close", (code) => {
    worker.rpc.flushRemaining();
    const turn = worker.currentTurn;
    if (turn && !turn.settled) {
      turn.chain.finally(() => {
        if (turn.settled) return;
        const stderrText = turn.stderrChunks.join("").trim();
        const classified = __wideTs.classifyCodexError(
          stderrText || `Codex exited unexpectedly (code ${code ?? "unknown"}).`,
        );
        if (turn.usedResume && classified.kind === "session_not_found" && !turn.hasText) {
          turn.finish({ ok: false, retryFreshSession: true, error: classified.message });
          return;
        }
        if (classified.kind === "auth") {
          codexLastStatus = null;
        }
        turn.finish({ ok: false, error: classified.message, errorKind: classified.kind });
      });
    }
    codexDisposeWorker(worker);
  });

  await worker.rpc.initialize(CODEX_RPC_TIMEOUT_MS);
  return worker;
}

async function codexEnsureWorkerThread(worker, { resumeThreadId, model, interactionMode }) {
  if (worker.threadId) return { ok: true, usedResume: false };
  const isAsk = String(interactionMode || "agent").trim().toLowerCase() === "ask";
  const cleanModel = String(model || "").trim();
  const useModel = cleanModel && cleanModel.toLowerCase() !== "default" ? cleanModel : undefined;

  if (resumeThreadId) {
    try {
      const resumed = await worker.rpc.call(
        "thread/resume",
        {
          threadId: resumeThreadId,
          ...(worker.root ? { cwd: worker.root } : {}),
          ...(useModel ? { model: useModel } : {}),
          approvalPolicy: "never",
          sandbox: isAsk ? "read-only" : "workspace-write",
        },
        CODEX_RPC_TIMEOUT_MS,
      );
      const id = String(resumed?.thread?.id || resumeThreadId).trim();
      worker.threadId = id;
      return { ok: true, usedResume: true };
    } catch (err) {
      const classified = __wideTs.classifyCodexError(String(err?.message || err));
      if (classified.kind !== "session_not_found") {
        throw err;
      }
    }
  }

  const startParams = __wideTs.buildCodexThreadStartParams({
    root: worker.root,
    model: useModel,
    mode: interactionMode,
    developerInstructions: worker.developerInstructions,
  });
  const started = await worker.rpc.call("thread/start", startParams, CODEX_RPC_TIMEOUT_MS);
  const newId = String(started?.thread?.id || "").trim();
  if (!newId) {
    throw new Error("Codex app-server did not return a thread ID.");
  }
  worker.threadId = newId;
  return { ok: true, usedResume: false };
}

function codexDispatchTurnToWorker(
  worker,
  {
    promptText,
    imagePaths,
    root,
    sessionId,
    model,
    effort,
    allowWrites,
    toolMode,
    allowBrowser,
    turnContext,
    usedResume,
    nextSyncedCount,
    signal,
    send,
  },
) {
  if (worker.idleTimer) {
    clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
  }

  return new Promise((resolve) => {
    const parser = new __wideTs.CodexAppServerNotificationParser();
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
      hasText: false,
      fullText: "",
      preEditSnapshots: new Map(),
      stderrChunks: [],
      chain: Promise.resolve(),
      settled: false,
      finish: (result) => {
        if (turn.settled) return;
        turn.settled = true;
        worker.busy = false;
        worker.activeTurnId = "";
        worker.currentTurn = null;
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        codexDeleteFiles(imagePaths);
        if (!worker.disposed) {
          worker.idleTimer = setTimeout(() => {
            codexDisposeWorker(worker);
          }, CODEX_IDLE_TTL_MS);
        }
        resolve(result);
      },
    };

    const onAbort = () => {
      if (worker.threadId && worker.activeTurnId) {
        worker.rpc.notify("turn/interrupt", {
          threadId: worker.threadId,
          turnId: worker.activeTurnId,
        });
      }
      turn.finish({ ok: false, error: "stopped" });
      codexDisposeWorker(worker);
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

    const cleanModel = String(model || "").trim();
    const input = __wideTs.buildCodexUserInputs(promptText, imagePaths);
    const turnParams = {
      threadId: worker.threadId,
      input,
      ...(cleanModel && cleanModel.toLowerCase() !== "default" ? { model: cleanModel } : {}),
      ...(effort ? { effort } : {}),
      ...(root ? { cwd: root } : {}),
      approvalPolicy: "never",
    };

    worker.rpc.call("turn/start", turnParams, CODEX_RPC_TIMEOUT_MS).then(
      (res) => {
        if (res?.turn?.id && !turn.settled) {
          worker.activeTurnId = String(res.turn.id);
        }
      },
      (err) => {
        const classified = __wideTs.classifyCodexError(String(err?.message || err));
        if (turn.usedResume && classified.kind === "session_not_found" && !turn.hasText) {
          turn.finish({ ok: false, retryFreshSession: true, error: classified.message });
          return;
        }
        if (classified.kind === "auth") {
          codexLastStatus = null;
        }
        turn.finish({ ok: false, error: classified.message, errorKind: classified.kind });
      },
    );
  });
}

async function aiRunCodexTurn({
  root,
  sessionId = "",
  model = "",
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
  const binPath = await codexPath();
  if (!binPath) {
    const msg = "OpenAI Codex CLI is not installed. Open the model picker to install it or run: npm install -g @openai/codex";
    send({ type: "error", message: msg, errorKind: "not_installed" });
    return { ok: false, error: msg };
  }

  const effectiveInteractionMode =
    interactionMode === "ask" || !allowWrites ? "ask" : "agent";
  const effectiveToolMode = __wideTs.aiNormalizeToolMode(toolMode);
  const config = await readAiConfig();
  const catalog = codexCachedModels && codexCachedModels.length > 0 ? codexCachedModels : __wideTs.DEFAULT_CODEX_MODELS;
  const resolvedEffort = __wideTs.resolveCodexEffortForModel(
    model,
    effort || config.codexEffort || "high",
    catalog,
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
    ? await getAiSessionCodexMeta(workerKey)
    : { codexThreadId: "", codexSyncedCount: 0 };

  let historyRewound = false;
  if (meta.codexSyncedCount > 0 && messages.length <= meta.codexSyncedCount) {
    historyRewound = true;
    meta = { codexThreadId: "", codexSyncedCount: 0 };
    if (workerKey) {
      await setAiSessionCodexMeta(workerKey, { codexThreadId: "", codexSyncedCount: 0 });
    }
    aiCloseCodexSession(workerKey);
  }

  const sig = codexWorkerSignature({
    root,
    model,
    interactionMode: effectiveInteractionMode,
    toolMode: effectiveToolMode,
    allowBrowser,
    allowWrites,
    language,
  });

  const developerInstructions = codexBuildDeveloperInstructions({
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

  let existingWorker = workerKey ? CODEX_WORKERS.get(workerKey) : null;
  if (existingWorker && (existingWorker.disposed || existingWorker.busy || existingWorker.signature !== sig)) {
    codexDisposeWorker(existingWorker);
    existingWorker = null;
  }

  if (existingWorker && existingWorker.proc && existingWorker.proc.stdin?.writable && existingWorker.threadId) {
    const tempImgs = codexWriteTempImages(images);
    const res = await codexDispatchTurnToWorker(existingWorker, {
      promptText: lastUserText,
      imagePaths: tempImgs,
      root,
      sessionId: workerKey,
      model,
      effort: resolvedEffort,
      allowWrites,
      toolMode: effectiveToolMode,
      allowBrowser,
      turnContext,
      usedResume: false,
      nextSyncedCount: messages.length,
      signal,
      send,
    });
    if (!res.ok) {
      if (res.error !== "stopped") {
        send({
          type: "error",
          message: res.error || "Codex execution failed.",
          ...(res.errorKind ? { errorKind: res.errorKind } : {}),
        });
      }
      codexDisposeWorker(existingWorker);
    }
    return res;
  }

  const resumeCandidate = !historyRewound && meta.codexSyncedCount > 0 && meta.codexThreadId
    ? meta.codexThreadId
    : "";

  const startAndDispatch = async (tryResumeId) => {
    let worker;
    try {
      worker = await codexSpawnWorker({
        workerKey,
        binPath,
        signature: sig,
        root,
        model,
        developerInstructions,
        interactionMode: effectiveInteractionMode,
        toolMode: effectiveToolMode,
        allowBrowser,
        allowWrites,
      });
      if (workerKey) {
        CODEX_WORKERS.set(workerKey, worker);
      }
      const ensured = await codexEnsureWorkerThread(worker, {
        resumeThreadId: tryResumeId,
        model,
        interactionMode: effectiveInteractionMode,
      });
      if (workerKey) {
        await setAiSessionCodexMeta(workerKey, { codexThreadId: worker.threadId });
      }
      const promptText =
        !ensured.usedResume && prior.length > 0
          ? `${claudeCodeFormatPriorHistory(prior)}${lastUserText}`
          : lastUserText;
      const tempImgs = codexWriteTempImages(images);
      return {
        worker,
        res: await codexDispatchTurnToWorker(worker, {
          promptText,
          imagePaths: tempImgs,
          root,
          sessionId: workerKey,
          model,
          effort: resolvedEffort,
          allowWrites,
          toolMode: effectiveToolMode,
          allowBrowser,
          turnContext,
          usedResume: ensured.usedResume,
          nextSyncedCount: messages.length,
          signal,
          send,
        }),
      };
    } catch (err) {
      if (worker) codexDisposeWorker(worker);
      const classified = __wideTs.classifyCodexError(String(err?.message || err));
      return {
        worker: null,
        res: { ok: false, error: classified.message, errorKind: classified.kind },
      };
    }
  };

  let attempt = await startAndDispatch(resumeCandidate);
  if (!attempt.res.ok && attempt.res.retryFreshSession) {
    if (attempt.worker) codexDisposeWorker(attempt.worker);
    if (workerKey) {
      await setAiSessionCodexMeta(workerKey, { codexThreadId: "", codexSyncedCount: 0 });
    }
    attempt = await startAndDispatch("");
  }

  if (!workerKey && attempt.worker) {
    codexDisposeWorker(attempt.worker);
  }
  if (!attempt.res.ok && attempt.res.error !== "stopped") {
    if (attempt.res.errorKind === "auth") {
      codexLastStatus = null;
    }
    send({
      type: "error",
      message: attempt.res.error || "Codex execution failed.",
      ...(attempt.res.errorKind ? { errorKind: attempt.res.errorKind } : {}),
    });
  }
  return attempt.res;
}

async function codexRunSingleShot({ binPath, prompt, model, effort, signal, timeoutMs }) {
  try {
    return await codexRpcExchange(
      binPath,
      async (rpc) => {
        const cleanModel = String(model || "").trim();
        const useModel = cleanModel && cleanModel.toLowerCase() !== "default" ? cleanModel : undefined;
        const startRes = await rpc.call(
          "thread/start",
          __wideTs.buildCodexThreadStartParams({
            model: useModel,
            mode: "ask",
            ephemeral: true,
          }),
          timeoutMs,
        );
        const threadId = String(startRes?.thread?.id || "").trim();
        if (!threadId) return { ok: false, text: "", error: "No thread id" };

        const parser = new __wideTs.CodexAppServerNotificationParser();
        let text = "";
        return await new Promise((resolve) => {
          const off = rpc.onMessage((msg) => {
            if (msg.id !== undefined && msg.id !== null) {
              rpc.reply(msg.id, { decision: "decline" });
              return;
            }
            for (const ev of parser.feedNotification(msg.method, msg.params || {})) {
              if (ev.type === "delta") {
                text += ev.text;
              } else if (ev.type === "turn_done") {
                off();
                if (ev.isError) {
                  resolve({ ok: false, text: "", error: ev.message || "Codex failed." });
                } else {
                  resolve({ ok: true, text: text.trim() });
                }
                return;
              }
            }
          });

          rpc
            .call(
              "turn/start",
              {
                threadId,
                input: __wideTs.buildCodexUserInputs(prompt),
                ...(useModel ? { model: useModel } : {}),
                ...(effort ? { effort } : {}),
                approvalPolicy: "never",
              },
              timeoutMs,
            )
            .catch((err) => {
              off();
              resolve({ ok: false, text: "", error: String(err?.message || err) });
            });
        });
      },
      { signal, timeoutMs },
    );
  } catch (err) {
    return { ok: false, text: "", error: String(err?.message || err) };
  }
}

async function aiCompleteCodex({ prefix, suffix, language, signal }) {
  const binPath = await codexPath();
  if (!binPath) return { ok: false, error: "Codex CLI is not installed." };
  const prompt = [
    `Complete the code snippet at <CURSOR>. Output ONLY the completion text to insert at <CURSOR> without markdown fences or explanations.`,
    language ? `Language: ${language}` : "",
    `${String(prefix || "").slice(-2500)}<CURSOR>${String(suffix || "").slice(0, 1000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await codexRunSingleShot({
    binPath,
    prompt,
    effort: "low",
    signal,
    timeoutMs: CODEX_COMPLETE_TIMEOUT_MS,
  });
  if (!res.ok || !res.text) {
    return { ok: false, error: res.error || "Codex completion failed." };
  }
  const completion = res.text.replace(/^```[\w-]*\n?/, "").replace(/\n?```\s*$/, "");
  return { ok: true, completion };
}

async function aiCompactCodex({ sessionId, model, messages, signal }) {
  const binPath = await codexPath();
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

  const res = await codexRunSingleShot({
    binPath,
    prompt,
    model,
    effort: "low",
    signal,
    timeoutMs: CODEX_COMPACT_TIMEOUT_MS,
  });
  if (!res.ok || !res.text) return null;

  if (sessionId) {
    aiCloseCodexSession(sessionId);
    await setAiSessionCodexMeta(sessionId, { codexThreadId: "", codexSyncedCount: 0 });
  }
  return res.text;
}

function registerCodexHandlers() {
  const checkInstalled = async () => {
    if (typeof requireInstalled !== "function") return null;
    return await requireInstalled("ai-assistant");
  };

  electron.ipcMain.handle("ai:codexStatus", async (_event, opts = {}) => {
    const gate = await checkInstalled();
    if (gate) return gate;
    return await codexReadStatus(opts || {});
  });

  electron.ipcMain.handle("ai:codexModels", async () => {
    const gate = await checkInstalled();
    if (gate) return gate;
    return await codexListModels("");
  });

  electron.ipcMain.handle("ai:codexInstall", async () => {
    const gate = await checkInstalled();
    if (gate) return gate;
    return await codexInstall(null);
  });

  electron.ipcMain.handle("ai:codexLogin", async () => {
    const gate = await checkInstalled();
    if (gate) return gate;
    const binPath = await codexPath();
    if (!binPath) return { ok: false, error: "Codex CLI is not installed yet." };
    const status = await codexReadStatus({ force: true });
    if (status.signedIn) {
      return { ok: true, signedIn: true, started: false, ...status };
    }
    return await codexOpenLoginTerminal(binPath);
  });

  electron.ipcMain.handle("ai:codexLogout", async () => {
    const gate = await checkInstalled();
    if (gate) return gate;
    codexStopAll();
    const binPath = await codexPath();
    if (binPath) {
      try {
        await codexRpcExchange(binPath, (rpc) => rpc.call("account/logout", {}, 8000), {
          timeoutMs: 8000,
        });
      } catch {
        await codexExecCapture(binPath, ["logout"], { timeoutMs: 8000 });
      }
    }
    codexLastStatus = null;
    return { ok: true, signedIn: false };
  });

  electron.ipcMain.handle("ai:closeCodexSession", async (_event, id) => {
    const gate = await checkInstalled();
    if (gate) return gate;
    aiCloseCodexSession(id);
    return { ok: true };
  });
}
