

const AI_CONFIG_FILE = () =>
  node_path.join(electron.app.getPath("userData"), "ai-config.json");
const AI_SESSION_DIR = () =>
  node_path.join(electron.app.getPath("userData"), "ai-sessions");
const AI_ACTIVE_CHAT_FILE = () =>
  node_path.join(electron.app.getPath("userData"), "active-chat.json");

const AI_CLOUD_PROVIDERS = new Set(["claude-code", "antigravity", "codex"]);

const AI_DEFAULT_CONFIG = {

  tab: "cloud",
  provider: "claude-code",
  cloudModel: {
    "claude-code": "",
    antigravity: "",
    codex: "",
  },
  localModel: "",

  allowWrites: true,
  toolMode: "full",
  interactionMode: "agent",
  allowBrowser: true,

  claudeCodeSignedIn: false,
  claudeEffort: "high",
  claudeFallbackModel: "sonnet",
  antigravityEffort: "high",
  codexEffort: "high",
};

let aiConfigCache = null;

function aiNormalizeConfigRecord(parsed) {
  const raw = parsed && typeof parsed === "object" ? parsed : {};
  const rawProvider = String(raw.provider || "").trim().toLowerCase();
  const provider = AI_CLOUD_PROVIDERS.has(rawProvider) ? rawProvider : AI_DEFAULT_CONFIG.provider;
  const rawCloudModel = raw.cloudModel && typeof raw.cloudModel === "object" ? raw.cloudModel : {};
  return {
    ...AI_DEFAULT_CONFIG,
    ...raw,
    provider,
    cloudModel: {
      "claude-code": typeof rawCloudModel["claude-code"] === "string" ? rawCloudModel["claude-code"] : "",
      antigravity: typeof rawCloudModel.antigravity === "string" ? rawCloudModel.antigravity : "",
      codex: typeof rawCloudModel.codex === "string" ? rawCloudModel.codex : "",
    },
  };
}

async function readAiConfig() {
  if (aiConfigCache) return aiConfigCache;
  try {
    const parsed = JSON.parse(await promises.readFile(AI_CONFIG_FILE(), "utf8"));
    aiConfigCache = aiNormalizeConfigRecord(parsed);
  } catch {
    aiConfigCache = aiNormalizeConfigRecord({});
  }
  return aiConfigCache;
}

async function writeAiConfig(next) {
  const normalized = aiNormalizeConfigRecord(next);
  aiConfigCache = normalized;
  try {
    await writeFileAtomic(AI_CONFIG_FILE(), JSON.stringify(normalized, null, 2), "utf8");
  } catch (error) {
    console.warn("[ai] The settings could not be saved:", error.message);
  }
  return normalized;
}

const AI_ID_PATTERN = /^[0-9a-f]{32}$/;

function newSessionId() {
  return node_crypto.randomBytes(16).toString("hex");
}

function sessionFile(id) {
  if (!AI_ID_PATTERN.test(String(id || ""))) return "";
  return node_path.join(AI_SESSION_DIR(), `${id}.json`);
}

const MAX_SESSION_MESSAGES = 200;

function sessionTitle(messages) {
  const first = (Array.isArray(messages) ? messages : []).find(
    (message) => message && message.role === "user" && typeof message.content === "string"
  );
  const text = String(first?.content ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

async function readAiSession(id) {
  const file = sessionFile(id);
  if (!file) return null;
  try {
    const parsed = JSON.parse(await promises.readFile(file, "utf8"));
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return {

      id: typeof parsed.id === "string" && parsed.id ? parsed.id : String(id),
      root: parsed.root ?? "",
      title: parsed.title || sessionTitle(messages),
      createdAt: Number(parsed.createdAt) || 0,
      updatedAt: Number(parsed.updatedAt) || 0,
      claudeSessionId: typeof parsed.claudeSessionId === "string" ? parsed.claudeSessionId : "",
      claudeSyncedCount: typeof parsed.claudeSyncedCount === "number" ? parsed.claudeSyncedCount : 0,
      antigravityConversationId: typeof parsed.antigravityConversationId === "string" ? parsed.antigravityConversationId : "",
      antigravitySyncedCount: typeof parsed.antigravitySyncedCount === "number" ? parsed.antigravitySyncedCount : 0,
      codexThreadId: typeof parsed.codexThreadId === "string" ? parsed.codexThreadId : "",
      codexSyncedCount: typeof parsed.codexSyncedCount === "number" ? parsed.codexSyncedCount : 0,
      messages,
    };
  } catch {
    return null;
  }
}

async function writeAiSession(id, root, messages, stamp) {
  const file = sessionFile(id);
  if (!file) return null;
  const trimmed = Array.isArray(messages) ? messages.slice(-MAX_SESSION_MESSAGES) : [];
  const existing = await readAiSession(id);
  const prevSynced = typeof existing?.claudeSyncedCount === "number" ? existing.claudeSyncedCount : 0;
  const prevAgySynced = typeof existing?.antigravitySyncedCount === "number" ? existing.antigravitySyncedCount : 0;
  const prevCodexSynced = typeof existing?.codexSyncedCount === "number" ? existing.codexSyncedCount : 0;
  const record = {
    id: String(id),
    root: root || existing?.root || "",

    title: existing?.title || sessionTitle(trimmed),
    createdAt: existing?.createdAt || stamp,
    updatedAt: stamp,
    claudeSessionId: existing?.claudeSessionId || "",
    claudeSyncedCount: trimmed.length < prevSynced ? 0 : prevSynced,
    antigravityConversationId: existing?.antigravityConversationId || "",
    antigravitySyncedCount: trimmed.length < prevAgySynced ? 0 : prevAgySynced,
    codexThreadId: existing?.codexThreadId || "",
    codexSyncedCount: trimmed.length < prevCodexSynced ? 0 : prevCodexSynced,
    messages: trimmed,
  };
  try {
    await promises.mkdir(AI_SESSION_DIR(), { recursive: true });
    await writeFileAtomic(file, JSON.stringify(record, null, 2), "utf8");
  } catch (error) {
    console.warn("[ai] The conversation could not be saved:", error.message);
    return null;
  }
  return record;
}

async function getAiSessionClaudeMeta(id) {
  const rec = await readAiSession(id);
  return {
    claudeSessionId: rec?.claudeSessionId || "",
    claudeSyncedCount: typeof rec?.claudeSyncedCount === "number" ? rec.claudeSyncedCount : 0,
  };
}

async function setAiSessionClaudeMeta(id, meta) {
  const file = sessionFile(id);
  if (!file) return null;
  const existing = await readAiSession(id);
  const now = Date.now();
  const record = existing
    ? { ...existing }
    : { id: String(id), root: "", title: "", createdAt: now, updatedAt: now, messages: [] };
  if (typeof meta?.claudeSessionId === "string") {
    record.claudeSessionId = meta.claudeSessionId;
  }
  if (typeof meta?.claudeSyncedCount === "number") {
    record.claudeSyncedCount = meta.claudeSyncedCount;
  }
  try {
    await promises.mkdir(AI_SESSION_DIR(), { recursive: true });
    await writeFileAtomic(file, JSON.stringify(record, null, 2), "utf8");
  } catch (error) {
    console.warn("[ai] The session metadata could not be saved:", error.message);
    return null;
  }
  return record;
}

async function getAiSessionAntigravityMeta(id) {
  const rec = await readAiSession(id);
  return {
    antigravityConversationId: rec?.antigravityConversationId || "",
    antigravitySyncedCount: typeof rec?.antigravitySyncedCount === "number" ? rec.antigravitySyncedCount : 0,
  };
}

async function setAiSessionAntigravityMeta(id, meta) {
  const file = sessionFile(id);
  if (!file) return null;
  const existing = await readAiSession(id);
  const now = Date.now();
  const record = existing
    ? { ...existing }
    : { id: String(id), root: "", title: "", createdAt: now, updatedAt: now, messages: [] };
  if (typeof meta?.antigravityConversationId === "string") {
    record.antigravityConversationId = meta.antigravityConversationId;
  }
  if (typeof meta?.antigravitySyncedCount === "number") {
    record.antigravitySyncedCount = meta.antigravitySyncedCount;
  }
  try {
    await promises.mkdir(AI_SESSION_DIR(), { recursive: true });
    await writeFileAtomic(file, JSON.stringify(record, null, 2), "utf8");
  } catch (error) {
    console.warn("[ai] The Antigravity session metadata could not be saved:", error.message);
    return null;
  }
  return record;
}

async function getAiSessionCodexMeta(id) {
  const rec = await readAiSession(id);
  return {
    codexThreadId: rec?.codexThreadId || "",
    codexSyncedCount: typeof rec?.codexSyncedCount === "number" ? rec.codexSyncedCount : 0,
  };
}

async function setAiSessionCodexMeta(id, meta) {
  const file = sessionFile(id);
  if (!file) return null;
  const existing = await readAiSession(id);
  const now = Date.now();
  const record = existing
    ? { ...existing }
    : { id: String(id), root: "", title: "", createdAt: now, updatedAt: now, messages: [] };
  if (typeof meta?.codexThreadId === "string") {
    record.codexThreadId = meta.codexThreadId;
  }
  if (typeof meta?.codexSyncedCount === "number") {
    record.codexSyncedCount = meta.codexSyncedCount;
  }
  try {
    await promises.mkdir(AI_SESSION_DIR(), { recursive: true });
    await writeFileAtomic(file, JSON.stringify(record, null, 2), "utf8");
  } catch (error) {
    console.warn("[ai] The Codex session metadata could not be saved:", error.message);
    return null;
  }
  return record;
}

async function listAiSessions(root) {
  let names = [];
  try {
    names = await promises.readdir(AI_SESSION_DIR());
  } catch {
    return [];
  }
  const wanted = String(root || "").toLowerCase();
  const found = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const record = await readAiSession(name.slice(0, -5));
    if (!record) continue;

    if (wanted && record.root && String(record.root).toLowerCase() !== wanted) continue;
    found.push({
      id: record.id,
      root: record.root || "",
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      count: record.messages.length,
    });
  }
  found.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  return found;
}

function registerAiStoreHandlers() {
  electron.ipcMain.handle("ai:config", async (_event, patch) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    if (!patch || typeof patch !== "object") {
      return { ok: true, config: await readAiConfig() };
    }
    const current = await readAiConfig();
    const next = {
      ...current,
      ...patch,
      cloudModel: { ...current.cloudModel, ...(patch.cloudModel ?? {}) },
    };
    return { ok: true, config: await writeAiConfig(next) };
  });

  electron.ipcMain.handle("ai:sessions", async (_event, root) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    return { ok: true, sessions: await listAiSessions(root) };
  });

  electron.ipcMain.handle("ai:session", async (_event, id) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const record = await readAiSession(id);
    if (!record) return { ok: false, error: "There is no such conversation." };
    return { ok: true, session: record };
  });

  electron.ipcMain.handle("ai:newSession", async (_event, root) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const now = Date.now();
    return {
      ok: true,
      session: { id: newSessionId(), root: root || "", title: "", createdAt: now, updatedAt: now, messages: [] },
    };
  });

  electron.ipcMain.handle("ai:saveSession", async (_event, id, root, messages) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const record = await writeAiSession(id, root, messages, Date.now());
    if (!record) return { ok: false, error: "The conversation could not be saved." };
    return { ok: true, session: { ...record, messages: undefined }, messages: record.messages };
  });

  electron.ipcMain.handle("ai:deleteSession", async (_event, id) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const file = sessionFile(id);
    if (!file) return { ok: false, error: "There is no such conversation." };
    if (typeof aiCloseClaudeSession === "function") {
      aiCloseClaudeSession(id);
    }
    if (typeof aiCloseAntigravitySession === "function") {
      aiCloseAntigravitySession(id);
    }
    if (typeof aiCloseCodexSession === "function") {
      aiCloseCodexSession(id);
    }
    try {
      await promises.rm(file, { force: true });
    } catch {

    }
    return { ok: true };
  });

  electron.ipcMain.handle("ai:activeChat", async (_event, payload) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const file = AI_ACTIVE_CHAT_FILE();
    if (payload && typeof payload === "object" && payload.id) {
      try {
        const record = {
          id: String(payload.id),
          root: String(payload.root || ""),
          title: String(payload.title || ""),
          timestamp: Date.now(),
        };
        await writeFileAtomic(file, JSON.stringify(record, null, 2), "utf8");
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    try {
      const data = await promises.readFile(file, "utf8");
      return { ok: true, activeChat: JSON.parse(data) };
    } catch {
      return { ok: true, activeChat: null };
    }
  });

  const handleIdeLaunch = async (_event, params) => {
    const projectPath = params?.projectPath ? String(params.projectPath) : "";
    let chatId = params?.chatId ? String(params.chatId) : "";
    if (!chatId) {
      try {
        const activeData = JSON.parse(await promises.readFile(AI_ACTIVE_CHAT_FILE(), "utf8"));
        if (activeData?.id) chatId = String(activeData.id);
      } catch (error) {
        reportRecoverableError("ai-store", "read active-chat failed", error, { ignoreCodes: ["ENOENT"] });
      }
    }

    if (chatId) {
      const record = await readAiSession(chatId);
      if (record) {
        const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, "");
        const appDataBase = process.env.APPDATA || (process.platform === "win32" ? node_path.join(node_os.homedir(), "AppData", "Roaming") : (process.env.XDG_CONFIG_HOME || node_path.join(node_os.homedir(), ".config")));
        const activeRecord = {
          id: String(chatId),
          root: String(projectPath || record.root || ""),
          title: String(record.title || ""),
          timestamp: Date.now(),
        };
        const activeJson = JSON.stringify(activeRecord, null, 2);
        const sessionJson = JSON.stringify(record, null, 2);

        const targetDirs = [
          node_path.join(appDataBase, "wide"),
          node_path.join(appDataBase, "Wide"),
          node_path.join(appDataBase, "Wide IDE"),
        ];

        if (projectPath) {
          targetDirs.push(node_path.join(projectPath, ".wide"));
        }

        for (const dir of targetDirs) {
          try {
            await promises.mkdir(dir, { recursive: true });
            const sDir = node_path.join(dir, "ai-sessions");
            await promises.mkdir(sDir, { recursive: true });
            await writeFileAtomic(node_path.join(sDir, `${safe}.json`), sessionJson, "utf8");
            await writeFileAtomic(node_path.join(dir, "active-chat.json"), activeJson, "utf8");
          } catch (error) {
            reportRecoverableError("ai-store", "sync active chat failed", error, { ignoreCodes: ["EACCES", "EPERM"] });
          }
        }
      }
    }

    const ideDirs = ["wide-ide", "wide"];
    const winSuffixes = [
      ["dist", "wide", "wide.exe"],
      ["native-host", "target", "release", "wide.exe"],
      ["native-host", "target", "debug", "wide.exe"],
    ];
    const candidates = [
      process.env.WIDE_IDE_PATH,
      process.env.WIDE_PATH,
      node_path.join(process.env.LOCALAPPDATA || "", "Programs", "Wide IDE", "wide.exe"),
      node_path.join(process.env.LOCALAPPDATA || "", "Programs", "Wide", "wide.exe"),
      node_path.join(process.env.PROGRAMFILES || "", "Wide IDE", "wide.exe"),
      node_path.join(process.env.PROGRAMFILES || "", "Wide", "wide.exe"),
      node_path.join(process.env["PROGRAMFILES(X86)"] || "", "Wide IDE", "wide.exe"),
      node_path.join(process.env["PROGRAMFILES(X86)"] || "", "Wide", "wide.exe"),
      ...ideDirs.flatMap((dir) => winSuffixes.map((s) => node_path.resolve(__dirname, "..", "..", "..", dir, ...s))),
      ...ideDirs.flatMap((dir) => winSuffixes.map((s) => node_path.resolve(process.cwd(), "..", dir, ...s))),
      "/usr/bin/wide",
      "/usr/local/bin/wide",
      node_path.join(process.env.HOME || "", ".local", "bin", "wide"),
      "/opt/wide/wide",
      "/opt/wide-ide/wide",
      ...ideDirs.map((dir) => node_path.resolve(__dirname, "..", "..", "..", dir, "native-host", "target", "release", "wide")),
      ...ideDirs.map((dir) => node_path.resolve(process.cwd(), "..", dir, "native-host", "target", "release", "wide")),
    ].filter(Boolean);

    let targetExe = null;
    for (const candidate of candidates) {
      try {
        await promises.access(candidate);
        targetExe = candidate;
        break;
      } catch {}
    }

    if (!targetExe) {
      try {
        const lookupCmd = process.platform === "win32" ? "where.exe" : "which";
        const found = node_child_process.execFileSync(lookupCmd, ["wide"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim().split(/\r?\n/)[0];
        if (found) {
          await promises.access(found);
          targetExe = found;
        }
      } catch {}
    }

    if (!targetExe) {
      return { ok: false, error: "Wide IDE executable was not found on this system." };
    }

    try {
      const args = projectPath ? [projectPath] : [];
      const child = node_child_process.spawn(targetExe, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return { ok: true, path: targetExe, launched: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  electron.ipcMain.handle("ide:launch", handleIdeLaunch);
  electron.ipcMain.handle("app:launchIde", handleIdeLaunch);
}
