const aiCloudTelemetry = {
  "claude-code": {
    requestsLimit: 50,
    requestsRemaining: 50,
    tokensLimit: 100000,
    tokensRemaining: 100000,
    requestsUsed: 0,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    resetAt: "",
    lastLatencyMs: 0,
    lastStatus: "ready",
    updatedAt: 0,
  },
  antigravity: {
    requestsLimit: 60,
    requestsRemaining: 60,
    tokensLimit: 200000,
    tokensRemaining: 200000,
    requestsUsed: 0,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    resetAt: "",
    lastLatencyMs: 0,
    lastStatus: "ready",
    updatedAt: 0,
  },
  codex: {
    requestsLimit: 60,
    requestsRemaining: 60,
    tokensLimit: 200000,
    tokensRemaining: 200000,
    requestsUsed: 0,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    resetAt: "",
    lastLatencyMs: 0,
    lastStatus: "ready",
    updatedAt: 0,
  },
};

function aiRecordCloudHeaders(provider, headers, statusCode, latencyMs = 0) {
  const slot = aiCloudTelemetry[provider];
  if (!slot) return;
  const h = headers || {};
  slot.requestsUsed += 1;
  slot.updatedAt = Date.now();
  if (latencyMs > 0) slot.lastLatencyMs = Math.round(latencyMs);
  slot.lastStatus = statusCode === 429 ? "rate_limited" : statusCode === 200 ? "ok" : "error";

  const reqLim = Number(
    h["anthropic-ratelimit-requests-limit"] ??
      h["x-ratelimit-limit-requests"] ??
      h["x-ratelimit-requests-limit"] ??
      0,
  );
  const reqRem = Number(
    h["anthropic-ratelimit-requests-remaining"] ??
      h["x-ratelimit-remaining-requests"] ??
      h["x-ratelimit-requests-remaining"] ??
      -1,
  );
  const tokLim = Number(
    h["anthropic-ratelimit-tokens-limit"] ??
      h["x-ratelimit-limit-tokens"] ??
      h["x-ratelimit-tokens-limit"] ??
      0,
  );
  const tokRem = Number(
    h["anthropic-ratelimit-tokens-remaining"] ??
      h["x-ratelimit-remaining-tokens"] ??
      h["x-ratelimit-tokens-remaining"] ??
      -1,
  );
  const reset = String(
    h["anthropic-ratelimit-requests-reset"] ??
      h["anthropic-ratelimit-tokens-reset"] ??
      h["x-ratelimit-reset-requests"] ??
      h["retry-after"] ??
      "",
  );

  if (reqLim > 0) slot.requestsLimit = reqLim;
  if (reqRem >= 0 && !Number.isNaN(reqRem)) {
    slot.requestsRemaining = reqRem;
  } else {
    slot.requestsRemaining = Math.max(0, slot.requestsLimit - (slot.requestsUsed % Math.max(1, slot.requestsLimit)));
  }
  if (tokLim > 0) slot.tokensLimit = tokLim;
  if (tokRem >= 0 && !Number.isNaN(tokRem)) {
    slot.tokensRemaining = tokRem;
  }
  if (reset) slot.resetAt = reset;
}

function aiRecordCloudUsage(provider, input = 0, output = 0) {
  const slot = aiCloudTelemetry[provider];
  if (!slot) return;
  const inTok = Math.max(0, Number(input) || 0);
  const outTok = Math.max(0, Number(output) || 0);
  const total = inTok + outTok;
  slot.inputTokens += inTok;
  slot.outputTokens += outTok;
  slot.tokensUsed += total;
  slot.updatedAt = Date.now();
  if (slot.tokensRemaining > 0 && total > 0) {
    slot.tokensRemaining = Math.max(0, slot.tokensRemaining - total);
  }
}

function aiGetCloudTelemetry() {
  return {
    "claude-code": { ...aiCloudTelemetry["claude-code"] },
    antigravity: { ...aiCloudTelemetry.antigravity },
    codex: { ...aiCloudTelemetry.codex },
  };
}
