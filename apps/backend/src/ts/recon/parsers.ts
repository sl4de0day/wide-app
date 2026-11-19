import { hammingDistance64, normalizeShingles, simhash64 } from './filters';

export interface DiscoveredLink {
  url: string;
  source: string;
  tag: string;
}

export interface FormField {
  name: string;
  type: string;
}

export interface FormInfo {
  action: string;
  method: string;
  fields: FormField[];
}

export interface RobotsPolicy {
  allows: (pathname: string) => boolean;
  entries: DiscoveredLink[];
}

export interface StateNode {
  id: number;
  url: string;
  title: string;
  simhash: string;
  status: number;
  depth: number;
}

export interface StateEdge {
  from: number;
  to: number;
  action: string;
}

export interface StateGraphSnapshot {
  nodes: StateNode[];
  edges: StateEdge[];
  dot: string;
}

const LINK_ATTR_PATTERNS: Array<{ re: RegExp; tag: string }> = [
  { re: /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, tag: 'a' },
  { re: /<link\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, tag: 'link' },
  { re: /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, tag: 'script' },
  { re: /<iframe\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, tag: 'iframe' },
  { re: /<frame\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, tag: 'frame' },
  { re: /<form\b[^>]*?\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, tag: 'form' },
  { re: /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, tag: 'img' },
];

const JS_CALL_PATTERNS: RegExp[] = [
  /fetch\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\.(?:get|post|put|delete|patch|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\.open\s*\(\s*["'`][A-Za-z]+["'`]\s*,\s*["'`]([^"'`]+)["'`]/g,
  /(?:url|uri|endpoint|baseURL|baseUrl|path|action|href)\s*:\s*["'`]([^"'`]+)["'`]/g,
];

const JS_STRING_URL_RE = /["'`]((?:https?:)?\/\/[^\s"'`<>]+|\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{2,})["'`]/g;

export function resolveHttpUrl(baseUrl: string, raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.startsWith('#') || /\s/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  for (const bad of ['javascript:', 'mailto:', 'data:', 'vbscript:', 'tel:', 'about:', '${']) {
    if (lower.startsWith(bad)) return null;
  }
  const idx = trimmed.indexOf('${');
  const cleaned = idx >= 0 ? trimmed.slice(0, idx) : trimmed;
  if (!cleaned) return null;
  try {
    const resolved = new URL(cleaned, baseUrl);
    resolved.hash = '';
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

export function extractLinksFromHtml(baseUrl: string, body: string): DiscoveredLink[] {
  let effectiveBase = baseUrl;
  const baseMatch = body.match(/<base\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (baseMatch) {
    const b = baseMatch[1] ?? baseMatch[2] ?? baseMatch[3] ?? '';
    const resolvedBase = resolveHttpUrl(baseUrl, b);
    if (resolvedBase) effectiveBase = resolvedBase;
  }

  const seen = new Set<string>();
  const out: DiscoveredLink[] = [];
  for (const { re, tag } of LINK_ATTR_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const raw = m[1] ?? m[2] ?? m[3] ?? '';
      const resolved = resolveHttpUrl(effectiveBase, raw);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        out.push({ url: resolved, source: 'html', tag });
      }
    }
  }
  return out;
}

export function extractScriptTexts(body: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (!/\bsrc\s*=/i.test(m[1]) && m[2].trim()) {
      out.push(m[2]);
    }
  }
  return out;
}

export function extractJsEndpoints(baseUrl: string, scriptText: string): DiscoveredLink[] {
  const seen = new Set<string>();
  const out: DiscoveredLink[] = [];
  const pushUrl = (raw: string, tag: string) => {
    const lower = raw.toLowerCase();
    if (
      lower.startsWith('application/') ||
      lower.startsWith('text/') ||
      lower.startsWith('image/') ||
      raw.includes('://www.w3.org/') ||
      raw.includes('://schemas.')
    ) {
      return;
    }
    const resolved = resolveHttpUrl(baseUrl, raw);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      out.push({ url: resolved, source: 'js', tag });
    }
  };

  for (const re of JS_CALL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(scriptText)) !== null) {
      if (m[1]) pushUrl(m[1], 'call');
    }
  }

  JS_STRING_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JS_STRING_URL_RE.exec(scriptText)) !== null) {
    if (m[1]) pushUrl(m[1], 'string');
  }
  return out;
}

export function extractFormsFromHtml(baseUrl: string, body: string): FormInfo[] {
  const forms: FormInfo[] = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = formRe.exec(body)) !== null) {
    const attrs = fm[1];
    const inner = fm[2];
    const actionRaw = attrs.match(/\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawAction = actionRaw ? (actionRaw[1] ?? actionRaw[2] ?? actionRaw[3] ?? '') : '';
    const action = rawAction ? resolveHttpUrl(baseUrl, rawAction) || baseUrl : baseUrl;
    const methodRaw = attrs.match(/\bmethod\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const method = (methodRaw ? (methodRaw[1] ?? methodRaw[2] ?? methodRaw[3] ?? 'get') : 'get').trim().toLowerCase() || 'get';

    const fields: FormField[] = [];
    const seenFields = new Set<string>();
    const fieldRe = /<(input|textarea|select)\b([^>]*)>/gi;
    let flm: RegExpExecArray | null;
    while ((flm = fieldRe.exec(inner)) !== null) {
      const ftag = flm[1].toLowerCase();
      const fattrs = flm[2];
      const nameM = fattrs.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const name = nameM ? (nameM[1] ?? nameM[2] ?? nameM[3] ?? '').trim() : '';
      if (!name || seenFields.has(name)) continue;
      seenFields.add(name);
      const typeM = fattrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const kind = ftag === 'input' ? (typeM ? (typeM[1] ?? typeM[2] ?? typeM[3] ?? 'text').toLowerCase() : 'text') : ftag;
      fields.push({ name, type: kind });
    }
    forms.push({ action, method, fields });
  }
  return forms;
}

export function parseResponseLinks(
  baseUrl: string,
  headers: Record<string, string>,
  body: string,
  jsCrawl = true,
): DiscoveredLink[] {
  const out = extractLinksFromHtml(baseUrl, body);
  if (!jsCrawl) return out;
  const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1]?.toLowerCase() || '';
  let pathname = '';
  try {
    pathname = new URL(baseUrl).pathname;
  } catch {}
  if (ct.includes('javascript') || ct.includes('ecmascript') || pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
    out.push(...extractJsEndpoints(baseUrl, body));
  } else {
    for (const s of extractScriptTexts(body)) {
      out.push(...extractJsEndpoints(baseUrl, s));
    }
  }
  return out;
}

function robotsRuleMatches(pattern: string, pathname: string): boolean {
  const endAnchored = pattern.endsWith('$');
  const core = endAnchored ? pattern.slice(0, -1) : pattern;
  if (!core) return true;
  const escaped = core.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}${endAnchored ? '$' : ''}`);
  return re.test(pathname);
}

export function parseRobotsTxt(baseUrl: string, text: string, userAgents: string[] = ['widebot', 'mozilla', '*']): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; pattern: string }> }> = [];
  let curAgents: string[] = [];
  let curRules: Array<{ allow: boolean; pattern: string }> = [];
  let lastWasAgent = false;
  const entries: DiscoveredLink[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!lastWasAgent && curAgents.length > 0) {
        groups.push({ agents: curAgents, rules: curRules });
        curAgents = [];
        curRules = [];
      }
      if (val) curAgents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (val) {
        curRules.push({ allow: field === 'allow', pattern: val });
        const resolved = resolveHttpUrl(baseUrl, val);
        if (resolved) entries.push({ url: resolved, source: 'robots', tag: field });
      }
    } else if (field === 'sitemap' && val) {
      const resolved = resolveHttpUrl(baseUrl, val);
      if (resolved) entries.push({ url: resolved, source: 'robots', tag: 'sitemap' });
    }
  }
  if (curAgents.length > 0) groups.push({ agents: curAgents, rules: curRules });

  const wants = userAgents.map((a) => a.toLowerCase());
  if (!wants.includes('*')) wants.push('*');
  let activeRules: Array<{ allow: boolean; pattern: string }> = [];
  for (const agent of wants) {
    const matched = groups.filter((g) => g.agents.includes(agent));
    if (matched.length > 0) {
      activeRules = matched.flatMap((g) => g.rules);
      break;
    }
  }

  return {
    allows(pathname: string): boolean {
      let bestAllow = false;
      let bestLen = -1;
      for (const r of activeRules) {
        if (robotsRuleMatches(r.pattern, pathname)) {
          const len = r.pattern.length;
          if (len > bestLen || (len === bestLen && r.allow)) {
            bestLen = len;
            bestAllow = r.allow;
          }
        }
      }
      return bestLen < 0 ? true : bestAllow;
    },
    entries,
  };
}

export function parseSitemapXml(baseUrl: string, xml: string): DiscoveredLink[] {
  const out: DiscoveredLink[] = [];
  const seen = new Set<string>();
  const re = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    const resolved = resolveHttpUrl(baseUrl, raw);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      out.push({ url: resolved, source: 'sitemap', tag: 'loc' });
    }
  }
  return out;
}

export class StateGraph {
  private readonly nodes: StateNode[] = [];
  private readonly edges: StateEdge[] = [];
  private readonly byUrl = new Map<string, number>();
  private readonly hashes: Array<{ fp: bigint; id: number; pathPrefix: string }> = [];
  private readonly adj = new Map<number, number[]>();
  private readonly threshold: number;

  constructor(threshold = 4) {
    this.threshold = Math.max(1, threshold);
  }

  recordTransition(
    fromUrl: string | null | undefined,
    toUrl: string,
    title = '',
    status = 200,
    depth = 0,
    body = '',
    action = 'navigate',
  ): number {
    const toId = this.ensureNode(toUrl, title, status, depth, body);
    if (fromUrl) {
      const fromId = this.byUrl.get(fromUrl);
      if (fromId !== undefined && fromId !== toId) {
        const dup = this.edges.some((e) => e.from === fromId && e.to === toId && e.action === action);
        if (!dup) {
          this.edges.push({ from: fromId, to: toId, action });
          const next = this.adj.get(fromId) || [];
          next.push(toId);
          this.adj.set(fromId, next);
        }
      }
    }
    return toId;
  }

  private ensureNode(url: string, title: string, status: number, depth: number, body: string): number {
    const existing = this.byUrl.get(url);
    if (existing !== undefined) return existing;
    const shingles = body ? normalizeShingles(body) : null;
    const fp = shingles ? simhash64(shingles) : 0n;
    const pathPrefix = url.split('?')[0];
    if (fp !== 0n && this.hashes.length < 4000) {
      for (const h of this.hashes) {
        if (h.pathPrefix === pathPrefix && hammingDistance64(fp, h.fp) <= this.threshold) {
          this.byUrl.set(url, h.id);
          return h.id;
        }
      }
    }
    const id = this.nodes.length;
    this.nodes.push({ id, url, title, simhash: fp.toString(16), status, depth });
    this.byUrl.set(url, id);
    if (fp !== 0n) this.hashes.push({ fp, id, pathPrefix });
    return id;
  }

  shortestPath(fromId: number, toId: number): number[] | null {
    if (fromId < 0 || fromId >= this.nodes.length || toId < 0 || toId >= this.nodes.length) return null;
    const queue: number[] = [fromId];
    const visited = new Set<number>([fromId]);
    const parent = new Map<number, number>();
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === toId) {
        const path = [toId];
        let step = toId;
        while (parent.has(step)) {
          const prev = parent.get(step)!;
          path.push(prev);
          step = prev;
        }
        return path.reverse();
      }
      for (const next of this.adj.get(cur) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          parent.set(next, cur);
          queue.push(next);
        }
      }
    }
    return null;
  }

  toDot(): string {
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const lines = ['digraph WideStateGraph {', '  rankdir=LR;'];
    for (const n of this.nodes) {
      lines.push(`  n${n.id} [label="${esc(`${n.url} (${n.status})`)}"];`);
    }
    for (const e of this.edges) {
      lines.push(`  n${e.from} -> n${e.to} [label="${esc(e.action)}"];`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  snapshot(): StateGraphSnapshot {
    return {
      nodes: [...this.nodes],
      edges: [...this.edges],
      dot: this.toDot(),
    };
  }
}
