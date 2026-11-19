import { bridge, type ReconCrawlEvent } from "@/lib/bridge";
import { parseHttpMessage } from "@/lib/httpMessage";

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  mode?: "standard" | "headless" | "hybrid";
  fieldScope?: "rdn" | "fqdn" | "dn";
  robotsAndSitemap?: boolean;
  probePaths?: boolean;
  filterSimilar?: boolean;
  allowPrivate?: boolean;
  signal?: { cancelled: boolean };
  onFound?: (requestText: string, url: string) => void;
  onProgress?: (visited: number, queued: number) => void;
  sessionHeaders?: [string, string][];
}

interface TrieNode {
  children: Map<string, TrieNode>;
  paramChild: TrieNode | null;
  promoted: boolean;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX24_RE = /^[0-9a-fA-F]{24,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_RE = /^-?\d+$/;

function normalizeDynamicSeg(seg: string): string {
  if (UUID_RE.test(seg)) return "{uuid}";
  if (DATE_RE.test(seg)) return "{date}";
  if (NUM_RE.test(seg)) return "{num}";
  if (HEX24_RE.test(seg) && /[a-fA-F]/.test(seg) && /\d/.test(seg)) return "{hex}";
  return seg;
}

export class ClientPathTrie {
  private readonly roots = new Map<string, TrieNode>();
  private readonly threshold: number;

  constructor(threshold = 10) {
    this.threshold = Math.max(2, threshold);
  }

  collapse(host: string, segments: string[]): string[] {
    let root = this.roots.get(host);
    if (!root) {
      root = { children: new Map(), paramChild: null, promoted: false };
      this.roots.set(host, root);
    }
    const out: string[] = [];
    let node: TrieNode = root;
    for (const rawSeg of segments) {
      const seg = normalizeDynamicSeg(rawSeg);
      if (node.promoted) {
        out.push("{param}");
        if (!node.paramChild) node.paramChild = { children: new Map(), paramChild: null, promoted: false };
        node = node.paramChild;
        continue;
      }
      let next = node.children.get(seg);
      if (!next) {
        next = { children: new Map(), paramChild: null, promoted: false };
        node.children.set(seg, next);
        if (node.children.size > this.threshold) {
          node.promoted = true;
          node.children.clear();
          node.paramChild = { children: new Map(), paramChild: null, promoted: false };
          out.push("{param}");
          node = node.paramChild;
          continue;
        }
      }
      out.push(seg);
      node = next;
    }
    return out;
  }
}

function mergeSession(headers: [string, string][], session: [string, string][]): [string, string][] {
  if (!session.length) return headers;
  const used = new Set(session.map(([k]) => k.toLowerCase()));
  const kept = headers.filter(([k]) => !used.has(k.toLowerCase()));
  return [...kept, ...session];
}

const LINK_RE = /(?:href|src|action)\s*=\s*["']([^"'#]+)["']/gi;
const FORM_RE = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
const ATTR_RE = (name: string) => new RegExp(`${name}\s*=\s*["']([^"']*)["']`, "i");
const INPUT_RE = /<(?:input|select|textarea)\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/gi;
const INPUT_VALUE_RE = /\bvalue\s*=\s*["']([^"']*)["']/i;
const JS_URL_RE = /["'`](\/(?:api|graphql|rest|v\d|ajax|internal|admin)[^"'`\s]*)["'`]/gi;
const FETCH_URL_RE = /(?:fetch|axios(?:\.\w+)?|\.(?:get|post|put|delete|patch|open))\s*\(\s*["'`]([^"'`]+)["'`]/gi;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function getRequestText(url: string): string {
  return `GET ${url}\nHost: ${hostOf(url)}\n\n`;
}

function formRequestText(action: string, method: string, body: string): string {
  const host = hostOf(action);
  if (method === "POST") {
    return `POST ${action}\nHost: ${host}\nContent-Type: application/x-www-form-urlencoded\nContent-Length: ${body.length}\n\n${body}`;
  }
  const joined = action + (action.includes("?") ? "&" : "?") + body;
  return `GET ${joined}\nHost: ${hostOf(joined)}\n\n`;
}

function extractForms(html: string, base: string, seedHost: string): string[] {
  const out: string[] = [];
  let form: RegExpExecArray | null;
  FORM_RE.lastIndex = 0;
  while ((form = FORM_RE.exec(html))) {
    const attrs = form[1];
    const inner = form[2];
    const actionMatch = ATTR_RE("action").exec(attrs);
    const methodMatch = ATTR_RE("method").exec(attrs);
    const method = (methodMatch?.[1] ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
    let action: URL;
    try {
      action = new URL(actionMatch?.[1] ?? base, base);
    } catch {
      continue;
    }
    if (action.protocol !== "http:" && action.protocol !== "https:") continue;
    if (action.host !== seedHost) continue;

    const fields: string[] = [];
    let input: RegExpExecArray | null;
    INPUT_RE.lastIndex = 0;
    while ((input = INPUT_RE.exec(inner))) {
      const name = input[1];
      const valueMatch = INPUT_VALUE_RE.exec(input[0]);
      const value = valueMatch ? valueMatch[1] : "test";
      fields.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
    }
    action.hash = "";
    out.push(formRequestText(action.toString(), method, fields.join("&")));
  }
  return out;
}

function extractEndpoints(body: string, base: string, seedHost: string): string[] {
  const found = new Set<string>();
  for (const re of [JS_URL_RE, FETCH_URL_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      let abs: URL;
      try {
        abs = new URL(m[1], base);
      } catch {
        continue;
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (abs.host !== seedHost) continue;
      abs.hash = "";
      found.add(abs.toString());
    }
  }
  return [...found];
}

export async function crawl(seedUrl: string, opts: CrawlOptions = {}): Promise<string[]> {
  const maxPages = opts.maxPages ?? 60;
  const maxDepth = opts.maxDepth ?? 3;
  let seedHost = "";
  let parsedSeed: URL;
  try {
    parsedSeed = new URL(seedUrl);
    seedHost = parsedSeed.host;
  } catch {
    return [];
  }

  if (typeof bridge.reconCrawlStart === "function" && typeof bridge.onReconEvent === "function") {
    const backendFound: string[] = [];
    const seenReqs = new Set<string>();
    const emitBackend = (text: string, u: string) => {
      if (seenReqs.has(text)) return;
      seenReqs.add(text);
      backendFound.push(text);
      opts.onFound?.(text, u);
    };
    const isPrivateSeed = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(parsedSeed.hostname);
    const unsub = bridge.onReconEvent((ev: ReconCrawlEvent) => {
      if (opts.signal?.cancelled) return;
      if (ev.type === "progress") {
        opts.onProgress?.(ev.visited ?? 0, ev.queued ?? 0);
      } else if (ev.type === "page" && ev.page) {
        const pageUrl = ev.page.finalUrl || ev.page.url;
        emitBackend(getRequestText(pageUrl), pageUrl);
        for (const l of ev.page.links || []) {
          emitBackend(getRequestText(l), l);
        }
        for (const f of ev.page.forms || []) {
          const body = (f.fields || []).map((fld) => `${encodeURIComponent(fld.name)}=test`).join("&");
          emitBackend(formRequestText(f.action, (f.method || "GET").toUpperCase(), body), f.action);
        }
      }
    });
    try {
      const res = await bridge.reconCrawlStart({
        seeds: [seedUrl],
        mode: opts.mode ?? "standard",
        maxDepth,
        maxPages,
        fieldScope: opts.fieldScope ?? "rdn",
        robotsAndSitemap: opts.robotsAndSitemap ?? true,
        probePaths: opts.probePaths ?? true,
        filterSimilar: opts.filterSimilar ?? true,
        allowPrivate: opts.allowPrivate ?? isPrivateSeed,
        headers: opts.sessionHeaders ?? [],
      });
      unsub();
      if (res.ok) return backendFound;
    } catch {
      unsub();
    }
  }

  const visited = new Set<string>();
  const queued = new Set<string>([seedUrl]);
  const emitted = new Set<string>();
  const found: string[] = [];
  const queue: { url: string; depth: number }[] = [{ url: seedUrl, depth: 0 }];

  const emit = (text: string, url: string) => {
    if (emitted.has(text)) return;
    emitted.add(text);
    found.push(text);
    opts.onFound?.(text, url);
  };

  while (queue.length && visited.size < maxPages) {
    if (opts.signal?.cancelled) break;
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    emit(getRequestText(url), url);
    opts.onProgress?.(visited.size, queue.length);

    if (depth >= maxDepth) continue;
    const req = parseHttpMessage(getRequestText(url));
    if (!req) continue;
    req.headers = mergeSession(req.headers, opts.sessionHeaders ?? []);
    let reply;
    try {
      reply = await bridge.proxyReplay(req, { followRedirects: true });
    } catch {
      continue;
    }
    if (!reply.ok || !reply.body) continue;
    const ct = (reply.headers ?? []).find(([n]) => n.toLowerCase() === "content-type")?.[1] ?? "";
    const isHtml = /html/i.test(ct) || reply.body.includes("<a") || reply.body.includes("<form");

    if (isHtml) {
      for (const formText of extractForms(reply.body, url, seedHost)) emit(formText, url);
    }
    for (const endpoint of extractEndpoints(reply.body, url, seedHost)) {
      emit(getRequestText(endpoint), endpoint);
      if (!visited.has(endpoint) && !queued.has(endpoint)) {
        queued.add(endpoint);
        queue.push({ url: endpoint, depth: depth + 1 });
      }
    }

    if (!isHtml) continue;
    let m: RegExpExecArray | null;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(reply.body))) {
      let abs: URL;
      try {
        abs = new URL(m[1], url);
      } catch {
        continue;
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (abs.host !== seedHost) continue;
      abs.hash = "";
      const norm = abs.toString();
      if (!visited.has(norm) && !queued.has(norm)) {
        queued.add(norm);
        queue.push({ url: norm, depth: depth + 1 });
      }
    }
  }
  return found;
}
