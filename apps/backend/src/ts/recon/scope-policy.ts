export interface CidrRange {
  family: 4 | 6;
  network: bigint;
  prefixLen: number;
}

const SL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.tr',
  'org.tr',
  'gov.tr',
  'edu.tr',
  'net.tr',
  'com.au',
  'org.au',
  'net.au',
  'edu.au',
  'co.jp',
  'or.jp',
  'ne.jp',
  'com.br',
  'org.br',
  'co.in',
  'org.in',
  'com.cn',
  'co.kr',
  'co.nz',
  'co.za',
]);

function maskBits(value: bigint, prefixLen: number, totalBits: number): bigint {
  if (prefixLen <= 0) return 0n;
  const shift = BigInt(totalBits - prefixLen);
  const allOnes = (1n << BigInt(totalBits)) - 1n;
  return (value >> shift << shift) & allOnes;
}

export function parseIpv4Int(host: string): bigint | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let out = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8n) | BigInt(n);
  }
  return out;
}

export function parseIpv6Int(host: string): bigint | null {
  let clean = host.trim();
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.slice(1, -1);
  }
  const zoneIdx = clean.indexOf('%');
  if (zoneIdx >= 0) clean = clean.slice(0, zoneIdx);
  if (!clean.includes(':')) return null;

  const halves = clean.split('::');
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(':');
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok) return null;
      if (tok.includes('.')) {
        if (i !== tokens.length - 1) return null;
        const v4 = parseIpv4Int(tok);
        if (v4 === null) return null;
        out.push(Number((v4 >> 16n) & 0xffffn), Number(v4 & 0xffffn));
      } else if (/^[0-9a-fA-F]{1,4}$/.test(tok)) {
        out.push(Number.parseInt(tok, 16));
      } else {
        return null;
      }
    }
    return out;
  };

  const left = parseSide(halves[0]);
  if (!left) return null;
  const right = halves.length === 2 ? parseSide(halves[1]) : [];
  if (!right) return null;

  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null;

  const groups = [...left, ...new Array(missing).fill(0), ...right];
  if (groups.length !== 8) return null;
  let val = 0n;
  for (const g of groups) {
    val = (val << 16n) | BigInt(g);
  }
  return val;
}

function parseSingleHostIp(raw: string): bigint | null {
  const trimmed = raw.trim().replace(/^\[|\]$/g, '');
  const v4 = parseIpv4Int(trimmed);
  if (v4 !== null) return v4;
  if (/^\d+$/.test(trimmed)) {
    const num = BigInt(trimmed);
    if (num >= 0n && num <= 0xffffffffn) return num;
  }
  if (/^0x[0-9a-fA-F]{1,8}$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  return null;
}

export function parseCidr(spec: string): CidrRange | null {
  const s = spec.trim();
  const slash = s.indexOf('/');
  const addrPart = (slash >= 0 ? s.slice(0, slash) : s).trim();
  const prefixRaw = slash >= 0 ? s.slice(slash + 1).trim() : null;

  const v4 = parseIpv4Int(addrPart);
  if (v4 !== null) {
    const prefixLen = prefixRaw === null ? 32 : Number(prefixRaw);
    if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) return null;
    return { family: 4, network: maskBits(v4, prefixLen, 32), prefixLen };
  }

  const v6 = parseIpv6Int(addrPart);
  if (v6 !== null) {
    const prefixLen = prefixRaw === null ? 128 : Number(prefixRaw);
    if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 128) return null;
    return { family: 6, network: maskBits(v6, prefixLen, 128), prefixLen };
  }

  return null;
}

export function cidrContainsIp(cidr: CidrRange, ip: string): boolean {
  if (cidr.family === 4) {
    const v4 = parseSingleHostIp(ip);
    if (v4 === null) return false;
    return maskBits(v4, cidr.prefixLen, 32) === cidr.network;
  }
  const v6 = parseIpv6Int(ip);
  if (v6 === null) return false;
  return maskBits(v6, cidr.prefixLen, 128) === cidr.network;
}

export function isInternalIp(rawHost: string): boolean {
  const clean = rawHost.trim().replace(/^\[|\]$/g, '');
  const v4 = parseSingleHostIp(clean);
  if (v4 !== null) {
    const a = Number((v4 >> 24n) & 0xffn);
    const b = Number((v4 >> 16n) & 0xffn);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  const v6 = parseIpv6Int(clean);
  if (v6 !== null) {
    if (v6 === 0n || v6 === 1n) return true;
    const v4MappedPrefix = 0xffffn << 32n;
    if ((v6 & ~0xffffffffn) === v4MappedPrefix) {
      const embedded = v6 & 0xffffffffn;
      const b0 = Number((embedded >> 24n) & 0xffn);
      const b1 = Number((embedded >> 16n) & 0xffn);
      const dotted = `${b0}.${b1}.${Number((embedded >> 8n) & 0xffn)}.${Number(embedded & 0xffn)}`;
      return isInternalIp(dotted);
    }
    const topByte = Number((v6 >> 120n) & 0xffn);
    const top10 = Number((v6 >> 118n) & 0x3ffn);
    if ((topByte & 0xfe) === 0xfc) return true;
    if (top10 === 0x3fa) return true;
    if (topByte === 0xff) return true;
    return false;
  }
  return false;
}

export function isInternalHost(host: string): boolean {
  const clean = host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!clean) return false;
  if (
    clean === 'localhost' ||
    clean.endsWith('.localhost') ||
    clean.endsWith('.local') ||
    clean.endsWith('.internal') ||
    clean === 'metadata.google.internal'
  ) {
    return true;
  }
  return isInternalIp(clean);
}

export interface NetworkPolicyOptions {
  allowPrivate?: boolean;
  allowNonHttp?: boolean;
}

export class NetworkPolicy {
  private readonly allowPrivate: boolean;
  private readonly allowNonHttp: boolean;

  constructor(opts: NetworkPolicyOptions = {}) {
    this.allowPrivate = Boolean(opts.allowPrivate);
    this.allowNonHttp = Boolean(opts.allowNonHttp);
  }

  allows(rawUrl: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    if (!this.allowNonHttp && scheme !== 'http' && scheme !== 'https') {
      return false;
    }
    if (!this.allowPrivate && parsed.hostname && isInternalHost(parsed.hostname)) {
      return false;
    }
    return true;
  }
}

export function registrableDomain(hostname: string): string {
  const clean = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!clean) return '';
  if (parseSingleHostIp(clean) !== null || parseIpv6Int(clean) !== null) return clean;
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return clean;
  const tail2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (SL_SUFFIXES.has(tail2) && parts.length >= 3) {
    return `${parts[parts.length - 3]}.${tail2}`;
  }
  return tail2;
}

export interface ScopeOptions {
  fieldScope?: string;
  inScope?: string[];
  outScope?: string[];
  exclude?: string[];
  allowPrivate?: boolean;
  noScope?: boolean;
}

export class ScopeManager {
  private readonly fieldScope: string;
  private readonly customHostRe: RegExp | null;
  private readonly inScope: RegExp[];
  private readonly outScope: RegExp[];
  private readonly excludeCidrs: CidrRange[];
  private readonly network: NetworkPolicy;
  private readonly noScope: boolean;

  constructor(opts: ScopeOptions = {}) {
    const fs = (opts.fieldScope || 'rdn').trim().toLowerCase();
    this.fieldScope = fs || 'rdn';
    this.customHostRe = fs !== 'dn' && fs !== 'rdn' && fs !== 'fqdn' && fs !== '' ? new RegExp(opts.fieldScope!, 'i') : null;
    this.inScope = (opts.inScope || []).map((p) => new RegExp(p));
    this.outScope = (opts.outScope || []).map((p) => new RegExp(p));
    this.excludeCidrs = (opts.exclude || []).map(parseCidr).filter((c): c is CidrRange => c !== null);
    this.network = new NetworkPolicy({ allowPrivate: Boolean(opts.allowPrivate), allowNonHttp: false });
    this.noScope = Boolean(opts.noScope);
  }

  validate(rawUrl: string, rootHostname: string): boolean {
    if (!this.network.allows(rawUrl)) return false;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    const host = parsed.hostname;
    if (this.excludeCidrs.length > 0 && host) {
      if (this.excludeCidrs.some((c) => cidrContainsIp(c, host))) {
        return false;
      }
    }
    if (!this.noScope && !this.validateDns(host, rootHostname)) {
      return false;
    }
    for (const re of this.outScope) {
      if (re.test(parsed.href)) return false;
    }
    if (this.inScope.length === 0) return true;
    return this.inScope.some((re) => re.test(parsed.href));
  }

  private validateDns(host: string, rootHostname: string): boolean {
    const h = host.toLowerCase();
    const r = rootHostname.toLowerCase();
    if (this.customHostRe) return this.customHostRe.test(host);
    if (this.fieldScope === 'fqdn') return h === r;
    if (this.fieldScope === 'dn') {
      const reg = registrableDomain(r);
      const keyword = (reg.split('.')[0] || r).toLowerCase();
      return Boolean(keyword) && h.includes(keyword);
    }
    const rootReg = registrableDomain(r) || r;
    return h === rootReg || h.endsWith(`.${rootReg}`);
  }
}

export function checkScopePolicy(input: ScopeOptions & { url: string; rootHostname: string }): {
  allowed: boolean;
  internalHost: boolean;
  registrableRoot: string;
} {
  let host = '';
  try {
    host = new URL(input.url).hostname;
  } catch {
    return { allowed: false, internalHost: false, registrableRoot: '' };
  }
  const mgr = new ScopeManager(input);
  return {
    allowed: mgr.validate(input.url, input.rootHostname),
    internalHost: isInternalHost(host),
    registrableRoot: registrableDomain(input.rootHostname),
  };
}
