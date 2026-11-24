

const HTTP_TIMEOUT_MS = 30_000;
const HTTP_MAX_BYTES = 8 * 1024 * 1024;
const HTTP_MAX_REDIRECTS = 5;

let httpBreakerRegistry = null;
let httpSharedAgentPool = null;

function getHttpBreakerRegistry() {
  if (!httpBreakerRegistry && typeof __wideTs !== "undefined" && __wideTs?.HostBreakerRegistry) {
    httpBreakerRegistry = new __wideTs.HostBreakerRegistry();
  }
  return httpBreakerRegistry;
}

function getHttpSharedAgentPool() {
  if (!httpSharedAgentPool && typeof __wideTs !== "undefined" && __wideTs?.AgentPool) {
    httpSharedAgentPool = new __wideTs.AgentPool();
  }
  return httpSharedAgentPool;
}

function waitAbortable(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
    };
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function decodeBody(raw, encodingHeader) {
  const encoding = String(encodingHeader || "").toLowerCase().trim();
  try {
    if (encoding === "gzip" || encoding === "x-gzip") return node_zlib.gunzipSync(raw);
    if (encoding === "br") return node_zlib.brotliDecompressSync(raw);
    if (encoding === "deflate") return node_zlib.inflateSync(raw);
  } catch {

  }
  return raw;
}

function afterRedirect(status, method, headers, body) {
  if (status === 307 || status === 308) return { method, headers, body };
  if (status === 303 || (method !== "GET" && method !== "HEAD")) {

    const kept = headers.filter(
      ([name]) => !/^content-(length|type|encoding)$/i.test(name),
    );
    return { method: "GET", headers: kept, body: null };
  }
  return { method, headers, body };
}

function sendSingleHop(target, method, headers, body, redirectsLeft, options) {
  return new Promise((resolve) => {
    const signal = options && options.signal;
    if (signal && signal.aborted) {
      resolve({ ok: false, error: "Request cancelled." });
      return;
    }
    let url;
    try {
      url = new URL(target);
    } catch {
      resolve({ ok: false, error: `That is not a URL: ${target}` });
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      resolve({ ok: false, error: `Only http and https can be sent (${url.protocol}).` });
      return;
    }
    if (options?.allowCredentials !== true && (url.username || url.password)) {
      resolve({ ok: false, error: "Blocked URL containing embedded credentials (user:pass@)." });
      return;
    }
    const chain = Array.isArray(options?.chain) ? options.chain : [url.href];
    if (typeof __wideTs !== "undefined" && __wideTs?.checkUrlSecurity) {
      const sec = __wideTs.checkUrlSecurity(url.href, {
        allowPrivate: options?.allowPrivate !== false,
        allowCredentials: options?.allowCredentials === true,
      });
      if (!sec.allowed) {
        resolve({ ok: false, error: sec.reason });
        return;
      }
    } else if (options && options.allowPrivate === false && typeof reconEnforceSsrfPolicy === "function") {
      const ssrf = reconEnforceSsrfPolicy(url.href, { allowPrivate: false });
      if (!ssrf.allowed) {
        resolve({ ok: false, error: ssrf.error });
        return;
      }
    }

    const effectiveHeaders =
      options && options.tlsProfile && typeof reconApplyTlsPresetToHeaders === "function"
        ? reconApplyTlsPresetToHeaders(headers, options.tlsProfile)
        : headers;
    const tlsPreset =
      options && options.tlsProfile && typeof reconTlsProfilePreset === "function"
        ? reconTlsProfilePreset(options.tlsProfile)
        : null;
    const isProxied = Boolean(options && options.proxy && options.proxy.port);
    const transport = url.protocol === "https:" ? node_https : node_http;
    const startedAt = Date.now();
    const pool = getHttpSharedAgentPool();
    const requestOptions = { method, headers: Object.fromEntries(effectiveHeaders) };
    if (pool && !isProxied) {
      requestOptions.agent = pool.getAgent(url.protocol, Boolean(options && options.insecure));
    }
    if (url.protocol === "https:") {
      if (options && options.insecure) requestOptions.rejectUnauthorized = false;
      if (tlsPreset?.ciphers) requestOptions.ciphers = tlsPreset.ciphers;
    }

    const useProxyHttpOptions = isProxied && url.protocol === "http:";
    if (useProxyHttpOptions) {
      requestOptions.host = options.proxy.host || "127.0.0.1";
      requestOptions.port = options.proxy.port;
      requestOptions.path = url.href;
      if (!requestOptions.headers["host"] && !requestOptions.headers["Host"]) {
        requestOptions.headers["host"] = url.host;
      }
    }

    let settled = false;
    let request = null;
    const onAbort = () => {
      if (request) {
        try {
          request.destroy(new Error("Request cancelled."));
        } catch {
          void 0;
        }
      }
      finish({ ok: false, error: "Request cancelled." });
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
      resolve(result);
    };
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const onResponse = (response) => {
        const location = response.headers.location;
        if (
          location &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          redirectsLeft > 0
        ) {
          response.resume();
          const next = new URL(location, url).toString();
          const nextChain = [...chain, next];
          if (typeof __wideTs !== "undefined" && __wideTs?.validateRedirectChain) {
            const chainCheck = __wideTs.validateRedirectChain(nextChain, {
              maxRedirects: HTTP_MAX_REDIRECTS,
              allowPrivate: options?.allowPrivate !== false,
              allowCredentials: options?.allowCredentials === true,
            });
            if (!chainCheck.allowed) {
              finish({ ok: false, error: chainCheck.reason, redirects: nextChain });
              return;
            }
          }
          const after = afterRedirect(response.statusCode, method, headers, body);
          finish(sendSingleHop(next, after.method, after.headers, after.body, redirectsLeft - 1, { ...options, chain: nextChain }));
          return;
        }

        const chunks = [];
        let size = 0;
        let truncated = false;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > HTTP_MAX_BYTES) {
            truncated = true;
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("close", () => {
          if (signal && signal.aborted) {
            finish({ ok: false, error: "Request cancelled." });
            return;
          }
          if (!response.complete && !truncated) {
            finish({ ok: false, error: "The connection closed before the response finished." });
            return;
          }
          const raw = Buffer.concat(chunks);
          const decoded = truncated ? raw : decodeBody(raw, response.headers["content-encoding"]);
          finish({
            ok: true,
            status: response.statusCode,
            statusText: response.statusMessage ?? "",
            headers: Object.entries(response.headers).map(([name, value]) => [
              name,
              Array.isArray(value) ? value.join(", ") : String(value ?? ""),
            ]),
            body: decoded.toString("utf8"),
            bytes: size,
            truncated,
            ms: Date.now() - startedAt,
            url: url.toString(),
            redirects: chain,
          });
        });
      };

    request = useProxyHttpOptions
      ? transport.request(requestOptions, onResponse)
      : transport.request(url, requestOptions, onResponse);

    request.setTimeout(HTTP_TIMEOUT_MS, () => {
      request.destroy();
      finish({ ok: false, error: `No answer within ${HTTP_TIMEOUT_MS / 1000}s.` });
    });
    request.on("error", (error) => finish({ ok: false, error: error.message }));
    if (body != null && body !== "") {
      request.write(options && options.bodyBase64 ? Buffer.from(body, "base64") : body);
    }
    request.end();
  });
}

async function sendOnce(target, method, headers, body, redirectsLeft, options = {}) {
  const maxRetries = Math.max(0, Math.min(4, Number(options?.retries || 0)));
  const useBreaker = Boolean(options?.useBreaker);
  const registry = useBreaker ? getHttpBreakerRegistry() : null;

  if (registry && !registry.canTry(target)) {
    const snap = registry.getStatus(target);
    return {
      ok: false,
      error: `Circuit breaker OPEN for ${target}`,
      circuitState: snap.state,
    };
  }

  let lastResult = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await sendSingleHop(target, method, headers, body, redirectsLeft, options);
    lastResult = res;

    const retryableStatus = res.ok && (res.status === 429 || res.status >= 500);
    const blockedStatus = res.ok && (res.status === 403 || res.status === 429 || res.status >= 500);
    const networkFailure = !res.ok && !/Blocked|disallowed|credentials|invalid|cancelled/i.test(String(res.error || ""));

    if (registry) {
      if (blockedStatus) registry.recordStatus(target, res.status);
      else if (networkFailure) registry.recordError(target);
      else if (res.ok) registry.recordSuccess(target);
    }

    if ((retryableStatus || networkFailure) && attempt < maxRetries) {
      const waitMs =
        typeof __wideTs !== "undefined" && __wideTs?.computeJitterBackoffMs
          ? __wideTs.computeJitterBackoffMs(attempt, options?.backoffBaseMs ?? 250, options?.backoffJitterMs ?? 200)
          : 2 ** attempt * 250;
      const okWait = await waitAbortable(waitMs, options?.signal);
      if (!okWait) return { ok: false, error: "Request cancelled." };
      continue;
    }
    return res;
  }
  return lastResult || { ok: false, error: "Request failed." };
}

function registerHttpHandlers() {

  electron.ipcMain.handle("http:send", async (_event, url, method = "GET", headers = [], body = null, options = null) => {
    if (typeof url !== "string" || !url.trim()) return { ok: false, error: "No address." };
    const safeHeaders = Array.isArray(headers)
      ? headers.filter((pair) => Array.isArray(pair) && typeof pair[0] === "string")
      : [];
    const opts = options && typeof options === "object" ? options : {};
    return sendOnce(url.trim(), String(method || "GET").toUpperCase(), safeHeaders, body, HTTP_MAX_REDIRECTS, opts);
  });
}
