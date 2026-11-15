

electron.ipcMain.handle("app:getDiagnostics", async () => {
  if (typeof electron.hostRequest !== "function") {
    return {
      ok: true,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      logTail: "",
    };
  }
  try {
    const diagnostics = await electron.hostRequest("app:getDiagnostics", {});
    return diagnostics && typeof diagnostics === "object"
      ? diagnostics
      : { ok: false, error: "Diagnostics unavailable" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

let shutdownDone = false;
let shutdownPromise = null;
function shutdownServicesSync() {
  if (shutdownDone) return;
  shutdownDone = true;
  const syncSteps = [
    lspStopAll,
    disposeAllTerminals,
    disposeEngine,
    disposeTools,
    closeAllRealtime,
    closeAllGrpc,
    mcpDisposeAll,
    openCodeStop,
    stopProxy,
    stopOast,
    stopBuiltinOast,
    discordRpcShutdown,
  ];
  for (const step of syncSteps) {
    try {
      step();
    } catch {
      void 0;
    }
  }
}
function runWithTimeout(fn, timeoutMs) {
  return Promise.race([
    Promise.resolve().then(() => fn()),
    new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      t.unref?.();
    }),
  ]).catch(() => void 0);
}
function shutdownServices() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    shutdownServicesSync();
    for (const asyncStep of [disposeAiBrowser, disposeDatabases, dispose]) {
      await runWithTimeout(asyncStep, 2500);
    }
  })();
  return shutdownPromise;
}

let backendFailing = false;
function reportFatal(kind, error) {
  const detail = String((error && error.stack) || (error && error.message) || error);
  console.warn(`[backend] ${kind}:`, detail);

  try {
    const fs = require('node:fs');
    const node_path = require('node:path');
    const crashPath = node_path.join(electron.app.getPath('userData'), 'pending_crash.json');
    fs.writeFileSync(crashPath, JSON.stringify({
      kind,
      detail,
      os: process.platform,
      version: electron.app.getVersion(),
      timestamp: Date.now()
    }), 'utf8');
  } catch (e) {}

  if (backendFailing) return;
  backendFailing = true;
  try {
    broadcast("backend:fault", { kind, detail });
  } catch {
    void 0;
  }
  const timer = setTimeout(() => {
    backendFailing = false;
  }, 5000);
  timer.unref?.();
}

process.on("uncaughtException", (error) => {
  reportFatal("uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  reportFatal("unhandledRejection", reason);
});
process.on("exit", shutdownServicesSync);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  try {
    process.on(signal, () => {
      void shutdownServices().finally(() => process.exit(0));
    });
  } catch {
    void 0;
  }
}

if (typeof electron.__setShutdown === "function") {
  electron.__setShutdown(shutdownServices);
}

electron.app.whenReady().then(async () => {
  try {
    openSplash();
    if (typeof electron.__initSecrets === "function") {
      try {
        await electron.__initSecrets();
      } catch {
        void 0;
      }
    }
    await boot();

    registerSssfHandlers();
    registerFsHandlers();
    registerWorkspaceHandlers();
    registerWorkflowHandlers();
    registerPerfHandlers();
    registerWindowHandlers();
    registerSearchHandlers();
    registerTsHandlers();
    registerProjectHandlers();
    registerTerminalHandlers();
    registerTestHandlers();
    registerOsvHandlers();
    registerEngineHandlers();
    registerHttpHandlers();
    registerFormatHandlers();
    registerLintHandlers();
    registerLspHandlers();
    registerToolHandlers();
    registerExtensionHandlers();
    registerPrepareHandlers();
    registerCodebergHandlers();
    registerCommentHandlers();
    registerAiStoreHandlers();
    registerAiCatalogHandlers();
    registerAiLocalHandlers();
    registerMcpHandlers();
    registerAiAgentHandlers();
    registerAiBrowserHandlers();
    registerClaudeCodeHandlers();
    registerOpenCodeHandlers();
    registerBrowserHandlers();
    registerProxyHandlers();
    registerDebugHandlers();
    registerRemoteHandlers();
    registerUpdateHandlers();
    registerSecScanHandlers();
    registerToolScanHandlers();
    registerWebtoolsHandlers();
    registerOastHandlers();
    registerVaultHandlers();
    registerRealtimeHandlers();
    registerGrpcHandlers();
    registerDiscordRpcHandlers();
    registerDatabaseHandlers();
  } catch (error) {
    console.error("[boot] Backend initialization failed:", error);
    reportFatal("boot", error);
  } finally {
    if (typeof electron.__markReady === "function") {
      electron.__markReady();
    }
  }
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("before-quit", () => {
  void shutdownServices();
});
electron.app.on("window-all-closed", () => {
  void shutdownServices().finally(() => {
    if (!isMac) {
      electron.app.quit();
    }
  });
});

