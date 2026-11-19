import { describe, expect, it } from "vitest";

import { ClientPathTrie } from "@/lib/activeScan/crawler";
import { PROBES } from "@/lib/activeScan/probes";
import type { ProxyEntry } from "@/lib/bridge";
import { mineJs, shannonEntropy } from "@/lib/jsMiner";
import { passiveChecks } from "@/lib/passiveScan";
import { analyze, BUILTIN_WAPPALYZER_RULESET, mergeWappalyzerRulesets, signalsFromResponse } from "@/lib/wappalyzer";

describe("recon UI algorithms", () => {
  it("collapses numeric IDs and high-cardinality segments with ClientPathTrie", () => {
    const trie = new ClientPathTrie(2);
    expect(trie.collapse("app.test", ["users", "42"])).toEqual(["users", "{num}"]);
    trie.collapse("app.test", ["items", "alpha"]);
    trie.collapse("app.test", ["items", "beta"]);
    expect(trie.collapse("app.test", ["items", "gamma"])).toEqual(["items", "{param}"]);
  });

  it("mines fetch endpoints, filters low-entropy secrets, and decodes JWT claims", () => {
    const header = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0";
    const payload = "eyJpc3MiOiJ3aWRlIiwic3ViIjoiYWRtaW4iLCJleHAiOjEwMDB9";
    const gkey = ["AIza", "SyD1234567890abcdefghijklmnopqrstuv"].join("");
    const code = `
      fetch("/api/v2/profile");
      const weak = { api_key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
      const prod = "${gkey}";
      const jwt = "${header}.${payload}.sigvalue1234";
    `;
    const mined = mineJs(code);
    expect(mined.endpoints).toContain("/api/v2/profile");
    expect(shannonEntropy("aaaaaaaaaaaaaaaa")).toBe(0);
    expect(mined.secrets.some((s) => s.kind === "Generic API Key")).toBe(false);
    expect(mined.secrets.some((s) => s.kind === "Google API Key")).toBe(true);
    const jwtSecret = mined.secrets.find((s) => s.kind === "JSON Web Token");
    expect(jwtSecret?.jwtClaims?.algNone).toBe(true);
    expect(jwtSecret?.jwtClaims?.expired).toBe(true);
    expect(jwtSecret?.jwtClaims?.iss).toBe("wide");
  });

  it("detects offline technologies via BUILTIN_WAPPALYZER_RULESET", () => {
    const html = `<html><body><div id="__next"></div><div data-reactroot></div><script src="/app/jquery-3.7.1.min.js"></script></body></html>`;
    const headers: [string, string][] = [["Server", "nginx/1.25.2"], ["X-Powered-By", "Next.js"]];
    const signals = signalsFromResponse("https://app.example.com/", headers, html);
    const ruleset = mergeWappalyzerRulesets(BUILTIN_WAPPALYZER_RULESET, null);
    const detected = analyze(signals, ruleset);
    expect(detected.some((d) => d.name === "Nginx" && d.version === "1.25.2")).toBe(true);
    expect(detected.some((d) => d.name === "Next.js")).toBe(true);
    expect(detected.some((d) => d.name === "React")).toBe(true);
    expect(detected.some((d) => d.name === "jQuery" && d.version === "3.7.1")).toBe(true);
  });

  it("flags RFC 9112 smuggling ambiguity, encoding evasion, and SQLi/XSS vectors in passiveChecks", () => {
    const entry: ProxyEntry = {
      id: 901,
      at: Date.now(),
      ms: 12,
      method: "POST",
      url: "https://app.example.com/search?q=%u0027%20UNION%20SELECT%201,2--",
      host: "app.example.com",
      scheme: "https",
      status: 200,
      reqHeaders: [
        ["Host", "app.example.com"],
        ["Content-Length", "18"],
        ["Transfer-Encoding", "chunked"],
      ],
      reqBody: "<svg onload=alert(1)>",
      resHeaders: [
        ["Content-Type", "text/html"],
        ["Content-Security-Policy", "default-src 'self'"],
        ["Strict-Transport-Security", "max-age=31536000"],
        ["X-Frame-Options", "DENY"],
        ["X-Content-Type-Options", "nosniff"],
      ],
      resBody: "<html><body>ok</body></html>",
    };
    const ids = passiveChecks(entry).map((i) => i.checkId);
    expect(ids).toContain("rfc9112-smuggling-request");
    expect(ids).toContain("encoding-evasion-signal");
    expect(ids).toContain("lexical-sqli-payload");
    expect(ids).toContain("lexical-xss-payload");
  });

  it("exposes evasion-encoding and http-smuggling-reflection active scan probes", () => {
    const evasionProbe = PROBES.find((p) => p.id === "evasion-encoding");
    const smuggleProbe = PROBES.find((p) => p.id === "http-smuggling-reflection");
    expect(evasionProbe).toBeTruthy();
    expect(smuggleProbe).toBeTruthy();

    const evasionCases = evasionProbe!.cases("test");
    const sqliHit = evasionCases[0].detect({
      status: 500,
      headers: [],
      body: "You have an error in your SQL syntax near test",
      baseline: { status: 200, headers: [], body: "ok" },
    });
    expect(sqliHit?.snippet).toContain("SQL syntax");

    const smuggleCases = smuggleProbe!.cases("test");
    const hdrHit = smuggleCases[0].detect({
      status: 200,
      headers: [["X-Wide-Smuggle", "injected"]],
      body: "",
      baseline: { status: 200, headers: [], body: "" },
    });
    expect(hdrHit?.snippet).toContain("injected header");
  });
});
