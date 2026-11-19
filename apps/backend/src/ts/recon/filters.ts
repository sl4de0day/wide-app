export const DEFAULT_DENIED_EXTENSIONS = new Set([
  '3g2', '3gp', '7z', 'apk', 'arj', 'avi', 'axd', 'bmp', 'csv', 'deb', 'dll', 'doc', 'drv',
  'eot', 'exe', 'flv', 'gif', 'gifv', 'gz', 'h264', 'ico', 'iso', 'jar', 'jpeg', 'jpg', 'lock',
  'm4a', 'm4v', 'map', 'mkv', 'mov', 'mp3', 'mp4', 'mpeg', 'mpg', 'msi', 'ogg', 'ogm', 'ogv',
  'otf', 'pdf', 'pkg', 'png', 'ppt', 'psd', 'rar', 'rm', 'rpm', 'svg', 'swf', 'sys', 'tar',
  'tif', 'tiff', 'ttf', 'vob', 'wav', 'webm', 'webp', 'wmv', 'woff', 'woff2', 'xcf', 'xls',
  'xlsx', 'zip',
]);

interface TrieNode {
  children: Map<string, TrieNode>;
  paramChild: TrieNode | null;
  promoted: boolean;
}

function makeNode(): TrieNode {
  return { children: new Map(), paramChild: null, promoted: false };
}

function walkTrie(node: TrieNode, segments: string[], idx: number, threshold: number, out: string[]): void {
  if (idx >= segments.length) return;
  const seg = segments[idx];

  if (node.promoted) {
    out.push('{param}');
    if (!node.paramChild) node.paramChild = makeNode();
    walkTrie(node.paramChild, segments, idx + 1, threshold, out);
    return;
  }

  if (!node.children.has(seg)) {
    node.children.set(seg, makeNode());
    if (node.children.size > threshold) {
      node.promoted = true;
      node.children.clear();
      if (!node.paramChild) node.paramChild = makeNode();
      out.push('{param}');
      walkTrie(node.paramChild, segments, idx + 1, threshold, out);
      return;
    }
  }

  out.push(seg);
  walkTrie(node.children.get(seg)!, segments, idx + 1, threshold, out);
}

export class PathTrie {
  private readonly threshold: number;
  private readonly maxHosts: number;
  private readonly roots = new Map<string, TrieNode>();

  constructor(threshold = 10, maxHosts = 10_000) {
    this.threshold = threshold > 0 ? threshold : 10;
    this.maxHosts = maxHosts > 0 ? maxHosts : 10_000;
  }

  fingerprint(host: string, segments: string[]): string[] {
    let root = this.roots.get(host);
    if (!root) {
      if (this.roots.size >= this.maxHosts) {
        const oldest = this.roots.keys().next().value;
        if (oldest !== undefined) this.roots.delete(oldest);
      }
      root = makeNode();
      this.roots.set(host, root);
    } else {
      this.roots.delete(host);
      this.roots.set(host, root);
    }
    const out: string[] = [];
    walkTrie(root, segments, 0, this.threshold, out);
    return out;
  }
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX64_RE = /^[0-9a-fA-F]{64}$/;
const HEX40_RE = /^[0-9a-fA-F]{40}$/;
const HEX32_RE = /^[0-9a-fA-F]{32}$/;
const HEX24_RE = /^[0-9a-fA-F]{24}$/;
const HEX8_RE = /^[0-9a-fA-F]{8,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_RE = /^-?\d+$/;

export function normalizeSegment(seg: string): string | null {
  if (!seg) return null;
  if (UUID_RE.test(seg)) return '{uuid}';
  if (HEX64_RE.test(seg)) return '{sha256}';
  if (HEX40_RE.test(seg)) return '{sha1}';
  if (HEX32_RE.test(seg)) return '{md5}';
  if (HEX24_RE.test(seg)) return '{oid}';
  if (DATE_RE.test(seg)) return '{date}';
  if (NUM_RE.test(seg)) return '{num}';
  if (seg.length >= 8 && HEX8_RE.test(seg) && /[a-fA-F]/.test(seg) && /\d/.test(seg)) return '{hex}';
  return null;
}

export function fingerprintUrl(raw: string, trie?: PathTrie): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  const path = parsed.pathname;
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  let segments = trimmed ? trimmed.split('/') : [];
  segments = segments.map((s) => normalizeSegment(s) ?? s);
  if (trie) {
    segments = trie.fingerprint(parsed.hostname, segments);
  }
  let normalizedPath = `/${segments.join('/')}`;
  if (path.endsWith('/') && segments.length > 0) normalizedPath += '/';

  let out = `${parsed.protocol}//${parsed.hostname}`;
  if (parsed.port) out += `:${parsed.port}`;
  out += normalizedPath;

  const keys = Array.from(new Set(Array.from(parsed.searchParams.keys()))).sort();
  if (keys.length > 0) {
    out += `?${keys.join('&')}`;
  }
  return out;
}

export function normalizePaths(urls: string[], threshold = 10): { fingerprints: string[] } {
  const trie = new PathTrie(threshold);
  return { fingerprints: urls.map((u) => fingerprintUrl(u, trie)) };
}

export class ExtensionValidator {
  private readonly matchSet: Set<string>;
  private readonly filterSet: Set<string>;

  constructor(matchExts: string[] = [], filterExts: string[] = [], noDefault = false) {
    const norm = (s: string) => {
      const cleaned = s.trim().replace(/^\./, '').toLowerCase();
      return cleaned === 'none' ? '' : cleaned;
    };
    this.matchSet = new Set(matchExts.map(norm));
    this.filterSet = noDefault ? new Set() : new Set(DEFAULT_DENIED_EXTENSIONS);
    for (const ext of filterExts) this.filterSet.add(norm(ext));
  }

  validate(rawUrl: string): boolean {
    let pathname = rawUrl;
    try {
      pathname = new URL(rawUrl).pathname;
    } catch {
      return false;
    }
    const last = pathname.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    const ext = dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
    if (this.matchSet.size > 0) return this.matchSet.has(ext);
    return !this.filterSet.has(ext);
  }
}

const STRIP_BLOCKS_RE = /<(script|style|noscript|svg|template|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;
const MAIN_RE = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i;
const BODY_RE = /<body\b[^>]*>([\s\S]*?)<\/body>/i;

export function extractVisibleText(raw: string): string {
  const head = raw.slice(0, 512).toLowerCase();
  const looksHtml =
    head.includes('<html') || head.includes('<!doctype') || raw.includes('<body') || raw.includes('<div') || raw.includes('<p');
  if (!looksHtml) return raw;
  const cleaned = raw.replace(STRIP_BLOCKS_RE, ' ');
  const pick = cleaned.match(MAIN_RE)?.[2] || cleaned.match(BODY_RE)?.[1] || cleaned;
  return pick.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeShingles(raw: string, shingleWidth = 3, minTokens = 5): string[] | null {
  const text = extractVisibleText(raw);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
  if (tokens.length < minTokens) return null;
  if (tokens.length < shingleWidth) return tokens;
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - shingleWidth; i++) {
    out.push(tokens.slice(i, i + shingleWidth).join(' '));
  }
  return out;
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) {
      hash ^= BigInt(c);
      hash = (hash * FNV_PRIME) & MASK_64;
    } else {
      const encoded = Buffer.from(input.slice(i, i + 1), 'utf8');
      for (const b of encoded) {
        hash ^= BigInt(b);
        hash = (hash * FNV_PRIME) & MASK_64;
      }
    }
  }
  return hash;
}

export function simhash64(features: string[]): bigint {
  if (features.length === 0) return 0n;
  const counts = new Map<string, number>();
  for (const f of features) {
    counts.set(f, (counts.get(f) || 0) + 1);
  }
  const weights = new Int32Array(64);
  for (const [feature, weight] of counts) {
    const h = fnv1a64(feature);
    for (let bit = 0; bit < 64; bit++) {
      if ((h >> BigInt(bit)) & 1n) {
        weights[bit] += weight;
      } else {
        weights[bit] -= weight;
      }
    }
  }
  let fp = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit] > 0) fp |= 1n << BigInt(bit);
  }
  return fp;
}

export function hammingDistance64(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

export class SimHashIndex {
  private readonly maxDistance: number;
  private readonly budget: number;
  private readonly maxDocs: number;
  private readonly sigs: Array<{ id: number; fp: bigint }> = [];
  private readonly clusters = new Map<number, number>();
  private nextId = 0;

  constructor(maxDistance = 8, budget = 3, maxDocs = 1000) {
    this.maxDistance = maxDistance > 0 ? maxDistance : 3;
    this.budget = Math.max(1, budget);
    this.maxDocs = Math.max(10, maxDocs);
  }

  accept(body: string): boolean {
    const shingles = normalizeShingles(body);
    if (!shingles) return true;
    const fp = simhash64(shingles);
    let bestId = -1;
    let bestDist = Infinity;
    for (const s of this.sigs) {
      const d = hammingDistance64(fp, s.fp);
      if (d < bestDist) {
        bestDist = d;
        bestId = s.id;
      }
    }
    if (bestId >= 0 && bestDist <= this.maxDistance) {
      const count = this.clusters.get(bestId) || 0;
      if (count >= this.budget) return false;
      this.clusters.set(bestId, count + 1);
      return true;
    }
    while (this.sigs.length >= this.maxDocs) {
      const evicted = this.sigs.shift();
      if (evicted) this.clusters.delete(evicted.id);
    }
    const id = this.nextId++;
    this.sigs.push({ id, fp });
    this.clusters.set(id, 1);
    return true;
  }
}

interface LexicalDoc {
  tf: Map<string, number>;
  len: number;
}

export class LexicalIndex {
  private readonly mode: 'tfidf' | 'bm25';
  private readonly threshold: number;
  private readonly budget: number;
  private readonly corpus: LexicalDoc[] = [];
  private readonly df = new Map<string, number>();

  constructor(mode: 'tfidf' | 'bm25' = 'bm25', threshold = 0.85, budget = 256) {
    this.mode = mode;
    this.threshold = Math.min(1, Math.max(0.05, threshold));
    this.budget = Math.max(1, budget);
  }

  accept(body: string): boolean {
    const text = extractVisibleText(body);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2)
      .slice(0, 20_000);
    if (tokens.length < 5) return true;
    const tf = new Map<string, number>();
    for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
    const doc: LexicalDoc = { tf, len: tokens.length };
    const sim = this.maxSimilarity(doc);
    if (sim >= this.threshold) return false;
    for (const term of doc.tf.keys()) {
      this.df.set(term, (this.df.get(term) || 0) + 1);
    }
    this.corpus.push(doc);
    while (this.corpus.length > this.budget) {
      const old = this.corpus.shift();
      if (!old) break;
      for (const term of old.tf.keys()) {
        const next = (this.df.get(term) || 1) - 1;
        if (next <= 0) this.df.delete(term);
        else this.df.set(term, next);
      }
    }
    return true;
  }

  private maxSimilarity(query: LexicalDoc): number {
    if (this.corpus.length === 0 || query.tf.size === 0) return 0;
    const n = this.corpus.length;
    const idf = (term: string) => Math.log((n + 1) / ((this.df.get(term) || 0) + 1)) + 1;
    if (this.mode === 'tfidf') {
      const normOf = (d: LexicalDoc) => {
        let sum = 0;
        for (const [t, c] of d.tf) {
          const w = c * idf(t);
          sum += w * w;
        }
        return Math.sqrt(sum);
      };
      const qnorm = normOf(query);
      if (qnorm <= 0) return 0;
      let best = 0;
      for (const s of this.corpus) {
        const snorm = normOf(s);
        if (snorm <= 0) continue;
        let dot = 0;
        for (const [t, qc] of query.tf) {
          const sc = s.tf.get(t);
          if (sc) {
            const w = idf(t);
            dot += qc * w * (sc * w);
          }
        }
        best = Math.max(best, dot / (qnorm * snorm));
      }
      return best;
    }

    const totalLen = this.corpus.reduce((acc, d) => acc + d.len, 0);
    const avgdl = Math.max(1, totalLen / n);
    const k1 = 1.5;
    const b = 0.75;
    let selfScore = 0;
    for (const [t, qc] of query.tf) {
      const w = idf(t);
      const tfq = (qc * (k1 + 1)) / (qc + k1 * (1 - b + (b * query.len) / avgdl));
      selfScore += w * tfq;
    }
    if (selfScore <= 0) return 0;
    let best = 0;
    for (const s of this.corpus) {
      let score = 0;
      for (const [t] of query.tf) {
        const sc = s.tf.get(t);
        if (sc) {
          const w = idf(t);
          const tfs = (sc * (k1 + 1)) / (sc + k1 * (1 - b + (b * s.len) / avgdl));
          score += w * tfs;
        }
      }
      best = Math.max(best, Math.min(1, score / selfScore));
    }
    return best;
  }
}
