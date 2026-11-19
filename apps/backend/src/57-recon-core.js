const reconActiveCrawls = new Map();
let reconCrawlCounter = 0;

const RECON_PROBE_PATHS = [
  "/robots.txt",
  "/sitemap.xml",
  "/.well-known/security.txt",
  "/graphql",
  "/swagger.json",
  "/openapi.json",
  "/api-docs",
  "/.env",
  "/.git/HEAD",
  "/admin",
  "/login",
];

function reconSpiderBinName() {
  return process.platform === "win32" ? "wide-spider.exe" : "wide-spider";
}

function reconResolveSpiderBinary() {
  const bin = reconSpiderBinName();
  const candidates = [
    process.env.WIDE_SPIDER_BIN,
    node_path.resolve(__dirname, "..", "..", "native-core", "target", "release", bin),
    node_path.resolve(__dirname, "..", "..", "native-core", "target", "debug", bin),
    node_path.resolve(process.cwd(), "native-core", "target", "release", bin),
    node_path.resolve(process.cwd(), "wide-app", "native-core", "target", "release", bin),
    process.resourcesPath ? node_path.join(process.resourcesPath, "bin", bin) : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (node_fs.existsSync(candidate) && node_fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

function reconTlsProfilePreset(profile) {
  const key = String(profile || "").trim().toLowerCase();
  if (key === "chrome") {
    return {
      profile: "chrome",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      headers: [
        ["User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"],
        ["Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"],
        ["Accept-Language", "en-US,en;q=0.9"],
        ["Sec-Fetch-Dest", "document"],
        ["Sec-Fetch-Mode", "navigate"],
        ["Sec-Fetch-Site", "none"],
      ],
      ciphers: "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384",
    };
  }
  if (key === "firefox") {
    return {
      profile: "firefox",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
      headers: [
        ["User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0"],
        ["Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
        ["Accept-Language", "en-US,en;q=0.5"],
      ],
      ciphers: "TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_256_GCM_SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305",
    };
  }
  if (key === "safari") {
    return {
      profile: "safari",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      headers: [
        ["User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"],
        ["Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"],
        ["Accept-Language", "en-US,en;q=0.9"],
      ],
      ciphers: "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256",
    };
  }
  return null;
}

function reconApplyTlsPresetToHeaders(headerList, tlsProfile) {
  const preset = reconTlsProfilePreset(tlsProfile);
  if (!preset) return headerList;
  const existing = new Set((headerList || []).map(([k]) => String(k || "").toLowerCase()));
  const out = [...(headerList || [])];
  for (const [k, v] of preset.headers) {
    if (!existing.has(k.toLowerCase())) {
      out.push([k, v]);
    }
  }
  return out;
}

function reconEnforceSsrfPolicy(rawUrl, options = {}) {
  try {
    const parsed = new URL(rawUrl);
    if (options.allowCredentials !== true && (parsed.username || parsed.password)) {
      return {
        allowed: false,
        error: `Blocked URL containing embedded credentials (user:pass@): ${parsed.origin}`,
      };
    }
  } catch {
    return { allowed: false, error: `Invalid URL: ${rawUrl}` };
  }
  const allowPrivate = options.allowPrivate !== false;
  if (allowPrivate) return { allowed: true };
  if (!__wideTs || typeof __wideTs.NetworkPolicy !== "function") {
    return { allowed: true };
  }
  const policy = new __wideTs.NetworkPolicy({ allowPrivate: false, allowNonHttp: false });
  if (!policy.allows(rawUrl)) {
    return {
      allowed: false,
      error: `Blocked by Wide SSRF NetworkPolicy (internal/private host): ${rawUrl}`,
    };
  }
  return { allowed: true };
}

function reconHeaderArrayToMap(headers) {
  if (Array.isArray(headers)) {
    const out = {};
    for (const pair of headers) {
      if (Array.isArray(pair) && pair.length >= 2) {
        out[String(pair[0]).toLowerCase()] = String(pair[1] ?? "");
      }
    }
    return out;
  }
  if (headers && typeof headers === "object") {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
      out[String(k).toLowerCase()] = String(v ?? "");
    }
    return out;
  }
  return {};
}

function reconRunSpiderOneShot(payload, timeoutMs = 20000) {
  const bin = reconResolveSpiderBinary();
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    let proc = null;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    try {
      proc = node_child_process.spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch {
      finish(null);
      return;
    }
    const chunks = [];
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      finish(null);
    }, timeoutMs);
    timer.unref?.();
    proc.stdout.on("data", (d) => chunks.push(d));
    proc.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8").trim();
      try {
        finish(JSON.parse(text));
      } catch {
        finish(null);
      }
    });
    proc.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

async function reconAuditResponse(input = {}) {
  const headersMap = reconHeaderArrayToMap(input.headers);
  const url = String(input.url || "");
  if (!url) return { ok: false, error: "url is required" };
  if (input.preferNative) {
    const nativeRes = await reconRunSpiderOneShot({
      cmd: "audit",
      url,
      method: String(input.method || "GET"),
      headers: headersMap,
      reqContentType: String(input.reqContentType || ""),
      body: String(input.body || ""),
    });
    if (nativeRes) return { ok: true, engine: "native-rust", ...nativeRes };
  }
  const report = __wideTs.auditResponsePassive({
    url,
    method: String(input.method || "GET"),
    headers: headersMap,
    reqContentType: String(input.reqContentType || ""),
    body: String(input.body || ""),
    extractLinks: input.extractLinks !== false,
  });
  return {
    ok: true,
    engine: "node-ts",
    audit: report,
    links: report.links || [],
    forms: report.forms || [],
  };
}

function reconAuditEntryQuick(entry) {
  if (!entry || !entry.url || !__wideTs?.auditResponsePassive) return null;
  const reqHeaders = reconHeaderArrayToMap(entry.reqHeaders);
  const resHeaders = reconHeaderArrayToMap(entry.resHeaders);
  const body = typeof entry.resBody === "string" ? entry.resBody.slice(0, 262144) : "";
  const report = __wideTs.auditResponsePassive({
    url: entry.url,
    method: String(entry.method || "GET"),
    headers: resHeaders,
    reqContentType: reqHeaders["content-type"] || "",
    body,
    extractLinks: false,
  });
  return {
    endpointClass: report.endpointClass || null,
    technologies: report.technologies || [],
    securityIssueCount: Array.isArray(report.securityHeaders) ? report.securityHeaders.length : 0,
    jwtCount: Array.isArray(report.jwtTokens) ? report.jwtTokens.length : 0,
    secretCount: Array.isArray(report.secrets) ? report.secrets.length : 0,
  };
}

function reconNormalizePaths(urls, threshold = 10) {
  return __wideTs.normalizePaths(Array.isArray(urls) ? urls.map(String) : [], threshold);
}

function reconCheckScope(input = {}) {
  return __wideTs.checkScopePolicy({
    url: String(input.url || ""),
    rootHostname: String(input.rootHostname || ""),
    fieldScope: input.fieldScope || "rdn",
    inScope: Array.isArray(input.inScope) ? input.inScope : [],
    outScope: Array.isArray(input.outScope) ? input.outScope : [],
    exclude: Array.isArray(input.exclude) ? input.exclude : [],
    allowPrivate: Boolean(input.allowPrivate),
    noScope: Boolean(input.noScope),
  });
}

function reconDetectTech(headers, body) {
  return __wideTs.detectTechnologiesOffline(reconHeaderArrayToMap(headers), String(body || ""));
}

function reconFetchSimple(rawUrl, opts = {}) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      resolve({ ok: false, error: `Invalid URL: ${rawUrl}` });
      return;
    }
    const ssrf = reconEnforceSsrfPolicy(target.href, { allowPrivate: Boolean(opts.allowPrivate) });
    if (!ssrf.allowed) {
      resolve({ ok: false, error: ssrf.error });
      return;
    }
    const preset = reconTlsProfilePreset(opts.tlsProfile);
    const hdrPairs = reconApplyTlsPresetToHeaders(opts.headers || [], opts.tlsProfile);
    const outHeaders = {};
    for (const [k, v] of hdrPairs) outHeaders[k] = v;
    const transport = target.protocol === "https:" ? node_https : node_http;
    const started = Date.now();
    const reqOpts = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: "GET",
      path: target.pathname + target.search,
      headers: outHeaders,
    };
    if (target.protocol === "https:") {
      reqOpts.rejectUnauthorized = false;
      if (preset?.ciphers) reqOpts.ciphers = preset.ciphers;
    }
    const req = transport.request(reqOpts, (res) => {
      const status = res.statusCode || 0;
      const loc = res.headers.location;
      const redirectsLeft = opts.redirectsLeft ?? 5;
      if (loc && status >= 300 && status < 400 && redirectsLeft > 0) {
        res.resume();
        let nextHref = "";
        try {
          nextHref = new URL(loc, target).href;
        } catch {
          resolve({ ok: false, error: "Invalid redirect" });
          return;
        }
        resolve(reconFetchSimple(nextHref, { ...opts, redirectsLeft: redirectsLeft - 1 }));
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on("data", (c) => {
        bytes += c.length;
        if (bytes <= 2 * 1024 * 1024) chunks.push(c);
      });
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const body = typeof decodeBody === "function" ? decodeBody(raw, res.headers["content-encoding"]).toString("utf8") : raw.toString("utf8");
        const hdrMap = {};
        for (const [k, v] of Object.entries(res.headers || {})) {
          hdrMap[String(k).toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
        }
        resolve({
          ok: true,
          status,
          finalUrl: target.href,
          headers: hdrMap,
          body,
          contentLength: bytes,
          elapsedMs: Date.now() - started,
        });
      });
    });
    req.setTimeout(Math.max(1000, (opts.timeoutSecs || 15) * 1000), () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => resolve({ ok: false, error: String(err?.message || err) }));
    req.end();
  });
}

function reconBuildNodeCrawlerConfig(raw = {}) {
  const seeds = Array.isArray(raw.seeds) ? raw.seeds : raw.seedUrl ? [String(raw.seedUrl)] : [];
  return {
    seeds: seeds.map((s) => String(s || "").trim()).filter(Boolean),
    maxDepth: Math.max(0, Math.min(8, Number(raw.maxDepth ?? 3))),
    maxPages: Math.max(1, Math.min(2000, Number(raw.maxPages ?? 200))),
    concurrency: Math.max(1, Math.min(24, Number(raw.concurrency ?? 8))),
    rateLimit: raw.rateLimit ? Number(raw.rateLimit) : undefined,
    timeoutSecs: Math.max(1, Number(raw.timeoutSecs ?? 15)),
    retries: Math.max(0, Math.min(5, Number(raw.retries ?? 1))),
    jsCrawl: raw.jsCrawl !== false,
    robotsAndSitemap: raw.robotsAndSitemap !== false,
    probePaths: raw.probePaths !== false,
    pathClimb: Boolean(raw.pathClimb),
    filterSimilar: raw.filterSimilar !== false,
    useBm25: Boolean(raw.useBm25),
    simhashDistance: Math.max(1, Number(raw.simhashDistance ?? 8)),
    fieldScope: String(raw.fieldScope || "rdn"),
    inScope: Array.isArray(raw.inScope) ? raw.inScope : [],
    outScope: Array.isArray(raw.outScope) ? raw.outScope : [],
    exclude: Array.isArray(raw.exclude) ? raw.exclude : [],
    allowPrivate: Boolean(raw.allowPrivate),
    noScope: Boolean(raw.noScope),
    ignoreExtensions: Boolean(raw.ignoreExtensions),
    matchExtensions: Array.isArray(raw.matchExtensions) ? raw.matchExtensions : [],
    filterExtensions: Array.isArray(raw.filterExtensions) ? raw.filterExtensions : [],
    tlsProfile: String(raw.tlsProfile || "none"),
    headers: Array.isArray(raw.headers) ? raw.headers : [],
    mode: String(raw.mode || "standard"),
  };
}

function reconExtractHtmlTitle(body) {
  const m = String(body || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

async function reconRunNodeCrawl(crawlId, cfg, state, emit) {
  if (cfg.seeds.length === 0) throw new Error("At least one seed URL is required.");
  const rootUrl = new URL(cfg.seeds[0]);
  const rootHostname = rootUrl.hostname;
  const scope = new __wideTs.ScopeManager({
    fieldScope: cfg.fieldScope,
    inScope: cfg.inScope,
    outScope: cfg.outScope,
    exclude: cfg.exclude,
    allowPrivate: cfg.allowPrivate,
    noScope: cfg.noScope,
  });
  for (const s of cfg.seeds) {
    if (!scope.validate(s, rootHostname)) {
      throw new Error(`Seed URL blocked by scope or SSRF policy: ${s}`);
    }
  }
  const ext = new __wideTs.ExtensionValidator(cfg.matchExtensions, cfg.filterExtensions, false);
  const trie = new __wideTs.PathTrie(10);
  const seenUrls = new Set();
  const sim = cfg.filterSimilar
    ? cfg.useBm25
      ? new __wideTs.LexicalIndex("bm25", 0.85, 256)
      : new __wideTs.SimHashIndex(cfg.simhashDistance, 3)
    : null;
  const graph = new __wideTs.StateGraph(4);
  const frontier = [];
  let robotsPolicy = null;

  const enqueue = (rawUrl, depth, parentUrl, action) => {
    if (!scope.validate(rawUrl, rootHostname)) return false;
    if (!cfg.ignoreExtensions && !ext.validate(rawUrl)) return false;
    const fp = __wideTs.fingerprintUrl(rawUrl, trie);
    if (seenUrls.has(fp)) return false;
    seenUrls.add(fp);
    frontier.push({ url: rawUrl, depth, parentUrl, action });
    return true;
  };

  for (const s of cfg.seeds) {
    if (enqueue(s, 0, null, "seed") && cfg.probePaths) {
      const origin = new URL(s).origin;
      for (const p of RECON_PROBE_PATHS) {
        enqueue(`${origin}${p}`, 1, s, "probe");
      }
    }
  }

  if (cfg.robotsAndSitemap) {
    const origin = rootUrl.origin;
    const rb = await reconFetchSimple(`${origin}/robots.txt`, {
      allowPrivate: cfg.allowPrivate,
      timeoutSecs: cfg.timeoutSecs,
      tlsProfile: cfg.tlsProfile,
    });
    if (rb.ok && rb.status < 400) {
      robotsPolicy = __wideTs.parseRobotsTxt(`${origin}/robots.txt`, rb.body);
      for (const entry of robotsPolicy.entries) enqueue(entry.url, 1, `${origin}/robots.txt`, "robots");
    }
    const sm = await reconFetchSimple(`${origin}/sitemap.xml`, {
      allowPrivate: cfg.allowPrivate,
      timeoutSecs: cfg.timeoutSecs,
      tlsProfile: cfg.tlsProfile,
    });
    if (sm.ok && sm.status < 400) {
      for (const entry of __wideTs.parseSitemapXml(`${origin}/sitemap.xml`, sm.body)) {
        enqueue(entry.url, 1, `${origin}/sitemap.xml`, "sitemap");
      }
    }
  }

  let visited = 0;
  let emitted = 0;
  const minGapMs = cfg.rateLimit && cfg.rateLimit > 0 ? Math.floor(1000 / cfg.rateLimit) : 0;
  let nextSlotAt = 0;

  const takeNext = () => {
    while (frontier.length > 0) {
      const item = frontier.shift();
      if (!robotsPolicy) return item;
      try {
        if (robotsPolicy.allows(new URL(item.url).pathname)) return item;
      } catch {
        return item;
      }
    }
    return null;
  };

  const worker = async () => {
    while (!state.cancelled && visited < cfg.maxPages) {
      const item = takeNext();
      if (!item) break;
      if (minGapMs > 0) {
        const wait = nextSlotAt - Date.now();
        nextSlotAt = Math.max(Date.now(), nextSlotAt) + minGapMs;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      if (state.cancelled) break;
      const resp = await reconFetchSimple(item.url, {
        allowPrivate: cfg.allowPrivate,
        timeoutSecs: cfg.timeoutSecs,
        tlsProfile: cfg.tlsProfile,
        headers: cfg.headers,
      });
      if (!resp.ok) {
        emit({ type: "error", url: item.url, message: resp.error || "request failed" });
        continue;
      }
      visited += 1;
      const body = resp.body || "";
      const simOk = !sim || sim.accept(body) || item.depth === 0;
      if (simOk) {
        const discovered = __wideTs.parseResponseLinks(resp.finalUrl, resp.headers, body, cfg.jsCrawl);
        const forms = __wideTs.extractFormsFromHtml(resp.finalUrl, body);
        const audit = __wideTs.auditResponsePassive({
          url: resp.finalUrl,
          method: "GET",
          headers: resp.headers,
          body,
          extractLinks: false,
        });
        const title = reconExtractHtmlTitle(body);
        const fp = __wideTs.fingerprintUrl(resp.finalUrl, trie);
        for (const d of discovered) {
          if (item.depth < cfg.maxDepth) enqueue(d.url, item.depth + 1, item.url, `${d.source}:${d.tag}`);
        }
        graph.recordTransition(item.parentUrl, resp.finalUrl, title, resp.status, item.depth, body, item.action);
        emitted += 1;
        emit({
          type: "page",
          page: {
            url: item.url,
            finalUrl: resp.finalUrl,
            fingerprint: fp,
            status: resp.status,
            depth: item.depth,
            title,
            contentType: resp.headers["content-type"] || "",
            contentLength: resp.contentLength,
            elapsedMs: resp.elapsedMs,
            links: discovered.map((l) => l.url),
            forms,
            audit,
          },
        });
      }
      emit({ type: "progress", visited, queued: frontier.length, active: 1 });
    }
  };

  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, Math.max(1, cfg.maxPages)) }, () => worker()));
  const snap = graph.snapshot();
  emit({ type: "done", visited, pages: emitted, graph: snap });
  return { ok: true, crawlId, visited, pages: emitted, graph: snap };
}

async function reconRunHeadlessCrawl(crawlId, cfg, state, emit) {
  if (typeof aiBrowserEnsureReady !== "function" || !aiBrowserRuntime) {
    return await reconRunNodeCrawl(crawlId, cfg, state, emit);
  }
  const ready = await aiBrowserEnsureReady({ stealth: true });
  if (!ready || !aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return await reconRunNodeCrawl(crawlId, cfg, state, emit);
  }
  const page = aiBrowserRuntime.page;
  const rootUrl = new URL(cfg.seeds[0]);
  const scope = new __wideTs.ScopeManager({
    fieldScope: cfg.fieldScope,
    inScope: cfg.inScope,
    outScope: cfg.outScope,
    exclude: cfg.exclude,
    allowPrivate: cfg.allowPrivate,
    noScope: cfg.noScope,
  });
  const trie = new __wideTs.PathTrie(10);
  const sim = cfg.filterSimilar ? new __wideTs.SimHashIndex(cfg.simhashDistance, 3) : null;
  const graph = new __wideTs.StateGraph(4);
  const seen = new Set();
  const frontier = [];

  for (const s of cfg.seeds) {
    if (scope.validate(s, rootUrl.hostname)) {
      seen.add(__wideTs.fingerprintUrl(s, trie));
      frontier.push({ url: s, depth: 0, parentUrl: null, action: "seed" });
    }
  }

  let visited = 0;
  let emitted = 0;
  while (frontier.length > 0 && !state.cancelled && visited < cfg.maxPages) {
    const item = frontier.shift();
    try {
      const started = Date.now();
      const resp = await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: cfg.timeoutSecs * 1000 });
      await page.waitForTimeout(350);
      const finalUrl = page.url() || item.url;
      const html = await page.content();
      const title = await page.title().catch(() => "");
      const status = resp ? resp.status() : 200;
      const headers = resp ? resp.headers() : {};
      visited += 1;
      if (!sim || sim.accept(html) || item.depth === 0) {
        const discovered = __wideTs.parseResponseLinks(finalUrl, headers, html, cfg.jsCrawl);
        const forms = __wideTs.extractFormsFromHtml(finalUrl, html);
        const audit = __wideTs.auditResponsePassive({ url: finalUrl, method: "GET", headers, body: html, extractLinks: false });
        const fp = __wideTs.fingerprintUrl(finalUrl, trie);
        for (const d of discovered) {
          if (item.depth < cfg.maxDepth && scope.validate(d.url, rootUrl.hostname)) {
            const dfp = __wideTs.fingerprintUrl(d.url, trie);
            if (!seen.has(dfp)) {
              seen.add(dfp);
              frontier.push({ url: d.url, depth: item.depth + 1, parentUrl: item.url, action: `${d.source}:${d.tag}` });
            }
          }
        }
        graph.recordTransition(item.parentUrl, finalUrl, title, status, item.depth, html, item.action);
        emitted += 1;
        emit({
          type: "page",
          page: {
            url: item.url,
            finalUrl,
            fingerprint: fp,
            status,
            depth: item.depth,
            title,
            contentType: headers["content-type"] || "text/html",
            contentLength: html.length,
            elapsedMs: Date.now() - started,
            links: discovered.map((l) => l.url),
            forms,
            audit,
          },
        });
      }
      emit({ type: "progress", visited, queued: frontier.length, active: 1 });
    } catch (err) {
      emit({ type: "error", url: item.url, message: String(err?.message || err) });
    }
  }
  const snap = graph.snapshot();
  emit({ type: "done", visited, pages: emitted, graph: snap });
  return { ok: true, crawlId, visited, pages: emitted, graph: snap };
}

function reconStartCrawl(rawConfig = {}, onEvent) {
  const cfg = reconBuildNodeCrawlerConfig(rawConfig);
  const crawlId = `crawl-${++reconCrawlCounter}-${Date.now()}`;
  const state = { cancelled: false, proc: null };
  reconActiveCrawls.set(crawlId, state);

  const emit = (payload) => {
    const wrapped = { crawlId, ...payload };
    if (typeof onEvent === "function") {
      try {
        onEvent(wrapped);
      } catch {}
    }
    try {
      if (typeof broadcast === "function") broadcast("recon:event", wrapped);
    } catch {}
  };

  const finish = (res) => {
    reconActiveCrawls.delete(crawlId);
    return res;
  };

  if (cfg.mode === "headless") {
    return reconRunHeadlessCrawl(crawlId, cfg, state, emit).then(finish, (err) => {
      finish(null);
      return { ok: false, crawlId, error: String(err?.message || err) };
    });
  }

  const bin = rawConfig.useNodeFallback ? null : reconResolveSpiderBinary();
  if (!bin) {
    return reconRunNodeCrawl(crawlId, cfg, state, emit).then(finish, (err) => {
      finish(null);
      return { ok: false, crawlId, error: String(err?.message || err) };
    });
  }

  return new Promise((resolve) => {
    let proc = null;
    let buf = "";
    let doneEvt = null;
    try {
      proc = node_child_process.spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      state.proc = proc;
    } catch {
      void reconRunNodeCrawl(crawlId, cfg, state, emit).then(finish).then(resolve);
      return;
    }
    const errChunks = [];
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "done") doneEvt = parsed;
          emit(parsed);
        } catch {}
      }
    });
    proc.stderr.on("data", (d) => errChunks.push(d));
    proc.on("error", () => {
      void reconRunNodeCrawl(crawlId, cfg, state, emit).then(finish).then(resolve);
    });
    proc.on("close", (code) => {
      finish(null);
      if (state.cancelled) {
        resolve({ ok: true, crawlId, cancelled: true, ...(doneEvt || {}) });
        return;
      }
      if (code === 0) {
        resolve({ ok: true, crawlId, engine: "native-rust", ...(doneEvt || {}) });
        return;
      }
      const errText = Buffer.concat(errChunks).toString("utf8").trim() || `wide-spider exited with code ${code}`;
      emit({ type: "error", url: cfg.seeds[0] || "", message: errText });
      resolve({ ok: false, crawlId, error: errText });
    });
    proc.stdin.end(`${JSON.stringify({ cmd: "crawl", ...cfg })}\n`);
  });
}

function reconCancelCrawl(crawlId) {
  if (!crawlId) {
    for (const [id, st] of reconActiveCrawls) {
      st.cancelled = true;
      try {
        st.proc?.kill();
      } catch {}
      reconActiveCrawls.delete(id);
    }
    return { ok: true, cancelledAll: true };
  }
  const st = reconActiveCrawls.get(String(crawlId));
  if (!st) return { ok: false, error: "crawl not found" };
  st.cancelled = true;
  try {
    st.proc?.kill();
  } catch {}
  reconActiveCrawls.delete(String(crawlId));
  return { ok: true, crawlId };
}

function reconStopAll() {
  for (const [, st] of reconActiveCrawls) {
    st.cancelled = true;
    try {
      st.proc?.kill();
    } catch {}
  }
  reconActiveCrawls.clear();
}

function registerReconHandlers() {
  electron.ipcMain.handle("recon:status", async () => ({
    ok: true,
    nativeBinary: reconResolveSpiderBinary(),
    engines: [reconResolveSpiderBinary() ? "native-rust" : null, "node-ts", "headless-cdp"].filter(Boolean),
    activeCrawls: Array.from(reconActiveCrawls.keys()),
  }));

  electron.ipcMain.handle("recon:crawlStart", async (_e, config) => reconStartCrawl(config || {}));
  electron.ipcMain.handle("recon:crawlCancel", async (_e, crawlId) => reconCancelCrawl(crawlId));
  electron.ipcMain.handle("recon:auditResponse", async (_e, input) => reconAuditResponse(input || {}));
  electron.ipcMain.handle("recon:normalizePaths", async (_e, urls, threshold) => reconNormalizePaths(urls, threshold));
  electron.ipcMain.handle("recon:checkScope", async (_e, input) => reconCheckScope(input || {}));
  electron.ipcMain.handle("recon:detectTech", async (_e, headers, body) => ({
    ok: true,
    technologies: reconDetectTech(headers || {}, body || ""),
  }));
  electron.ipcMain.handle("recon:stateGraph", async (_e, transitions, threshold) => {
    const graph = new __wideTs.StateGraph(Number(threshold || 4));
    for (const t of Array.isArray(transitions) ? transitions : []) {
      graph.recordTransition(t.fromUrl, t.toUrl, t.title, t.status, t.depth, t.body || "", t.action || "navigate");
    }
    return { ok: true, ...graph.snapshot() };
  });

  electron.ipcMain.handle("proxy:inspectTraffic", async (_e, input, opts) => {
    const payload = reconResolveInspectPayload(input);
    if (!payload.url) return { ok: false, error: "Provide entry id or URL." };
    const report = __wideTs.evaluateHttpInspection(payload, opts || {});
    return { ok: true, ...report };
  });

  electron.ipcMain.handle("proxy:inspectReport", async (_e, opts = {}) => {
    const sourceEntries = Array.isArray(opts?.entries)
      ? opts.entries
      : typeof proxyLog !== "undefined" && Array.isArray(proxyLog)
        ? proxyLog.slice(-100)
        : [];
    const results = [];
    const drafts = [];
    for (const entry of sourceEntries) {
      const rep = __wideTs.evaluateHttpInspection(
        {
          url: entry.url || "",
          method: entry.method || "GET",
          headers: entry.reqHeaders || [],
          body: entry.reqBody || "",
        },
        { learning: opts?.learning !== false, exceptions: opts?.exceptions || [], level: opts?.level },
      );
      if (rep.action !== "pass" || rep.hits.length > 0 || rep.smugglingVectors.length > 0) {
        results.push({ id: entry.id, url: entry.url, method: entry.method, ...rep });
        drafts.push(...rep.drafts);
      }
    }
    return { ok: true, inspected: sourceEntries.length, flagged: results.length, results, drafts };
  });

  electron.ipcMain.handle("proxy:testSmuggling", async (_e, input = {}) => {
    const requestReport = input.rawRequest ? __wideTs.inspectRawHttpRequest(String(input.rawRequest)) : null;
    const responseReport = input.rawResponse ? __wideTs.inspectRawHttpResponse(String(input.rawResponse), String(input.method || "GET")) : null;
    const headerVectors = Array.isArray(input.headers) ? __wideTs.inspectHttpHeadersSmuggling(input.headers) : [];
    return { ok: true, requestReport, responseReport, headerVectors };
  });
}

function reconResolveInspectPayload(input) {
  if (typeof input === "number" || (input && typeof input === "object" && Number.isFinite(Number(input.id)) && !input.url)) {
    const id = typeof input === "number" ? input : Number(input.id);
    const entry = typeof proxyLog !== "undefined" && Array.isArray(proxyLog) ? proxyLog.find((x) => x.id === id) : null;
    if (entry) {
      return {
        url: entry.url || "",
        method: entry.method || "GET",
        headers: entry.reqHeaders || [],
        body: entry.reqBody || "",
      };
    }
  }
  const obj = input && typeof input === "object" ? input : {};
  return {
    url: String(obj.url || ""),
    method: String(obj.method || "GET"),
    headers: obj.reqHeaders || obj.headers || [],
    body: typeof obj.reqBody === "string" ? obj.reqBody : typeof obj.body === "string" ? obj.body : "",
    rawRequest: typeof obj.rawRequest === "string" ? obj.rawRequest : undefined,
    rawResponse: typeof obj.rawResponse === "string" ? obj.rawResponse : undefined,
  };
}

function reconInspectEntryQuick(entry) {
  if (!entry || !entry.url || !__wideTs?.evaluateHttpInspection) return null;
  const rep = __wideTs.evaluateHttpInspection(
    {
      url: entry.url,
      method: entry.method || "GET",
      headers: entry.reqHeaders || [],
      body: typeof entry.reqBody === "string" ? entry.reqBody.slice(0, 65536) : "",
    },
    { learning: true },
  );
  if (rep.action === "pass" && rep.hits.length === 0 && rep.smugglingVectors.length === 0 && !rep.signals.nullByte) {
    return null;
  }
  return {
    action: rep.action,
    trigger: rep.trigger,
    scores: rep.scores,
    hitCount: rep.hits.length,
    smugglingVectors: rep.smugglingVectors,
  };
}
