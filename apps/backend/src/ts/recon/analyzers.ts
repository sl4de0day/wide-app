import { DiscoveredLink, extractFormsFromHtml, FormInfo, parseResponseLinks } from './parsers';

export interface SecurityIssue {
  header: string;
  issue: string;
  severity: 'info' | 'low' | 'medium';
}

export interface DecodedJwt {
  rawPrefix: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  issues: string[];
}

export interface SecretHit {
  ruleId: string;
  kind: string;
  preview: string;
  entropy: number;
}

export interface PassiveAuditReport {
  url: string;
  securityHeaders: SecurityIssue[];
  jwtTokens: DecodedJwt[];
  secrets: SecretHit[];
  endpointClass: 'rest' | 'graphql' | 'soap' | 'xhr' | null;
  technologies: string[];
  emails: string[];
  comments: string[];
  links?: DiscoveredLink[];
  forms?: FormInfo[];
}

const PROTECTIVE_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
];

const DISCLOSURE_HEADERS = ['server', 'x-powered-by', 'x-aspnet-version'];
const MIN_HSTS_MAX_AGE = 15_552_000;

const SECRET_PATTERNS: Array<{ id: string; kind: string; re: RegExp; group: number; minEntropy: number }> = [
  { id: 'aws-access-key-id', kind: 'AWS Access Key ID', re: /\b(?:AKIA|ASIA|AGPA|AIDA)[0-9A-Z]{16}\b/g, group: 0, minEntropy: 0 },
  { id: 'google-api-key', kind: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, group: 0, minEntropy: 0 },
  { id: 'github-token', kind: 'GitHub Token', re: /\b(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{36,})\b/g, group: 0, minEntropy: 0 },
  { id: 'slack-token', kind: 'Slack Token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,48}\b/g, group: 0, minEntropy: 0 },
  { id: 'stripe-key', kind: 'Stripe Secret Key', re: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{24,99}\b/g, group: 0, minEntropy: 0 },
  { id: 'sendgrid-key', kind: 'SendGrid API Key', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, group: 0, minEntropy: 0 },
  { id: 'npm-token', kind: 'npm Token', re: /\bnpm_[A-Za-z0-9]{36}\b/g, group: 0, minEntropy: 0 },
  { id: 'private-key', kind: 'Private Key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, group: 0, minEntropy: 0 },
  {
    id: 'generic-secret',
    kind: 'Generic High-Entropy Secret',
    re: /(?:api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|client[_-]?secret)["'\s]*[:=]["'\s]*([A-Za-z0-9+/_\-.]{16,})/gi,
    group: 1,
    minEntropy: 3.5,
  },
];

const TECH_RULES: Array<{ name: string; header?: [string, RegExp?]; body?: RegExp }> = [
  { name: 'Nginx', header: ['server', /nginx/i] },
  { name: 'Apache', header: ['server', /apache/i] },
  { name: 'Microsoft-IIS', header: ['server', /iis|microsoft-iis/i] },
  { name: 'OpenResty', header: ['server', /openresty/i] },
  { name: 'Gunicorn', header: ['server', /gunicorn/i] },
  { name: 'Cloudflare', header: ['server', /cloudflare/i] },
  { name: 'Cloudflare', header: ['cf-ray'] },
  { name: 'Varnish', header: ['x-varnish'] },
  { name: 'PHP', header: ['x-powered-by', /php/i] },
  { name: 'Express', header: ['x-powered-by', /express/i] },
  { name: 'ASP.NET', header: ['x-powered-by', /asp\.net/i] },
  { name: 'ASP.NET', header: ['x-aspnet-version'] },
  { name: 'Next.js', header: ['x-powered-by', /next\.js/i] },
  { name: 'Drupal', header: ['x-generator', /drupal/i] },
  { name: 'WordPress', body: /wp-content|wp-includes|<meta[^>]+wordpress/i },
  { name: 'Next.js', body: /__NEXT_DATA__|\/_next\/static/ },
  { name: 'React', body: /__REACT_DEVTOOLS_GLOBAL_HOOK__|data-reactroot|react-dom/i },
  { name: 'Vue.js', body: /__VUE__|data-v-[0-9a-f]{6,}/i },
  { name: 'Angular', body: /ng-version=|ng-app=/i },
  { name: 'Svelte', body: /svelte-[a-z0-9]{5,}|__SVELTEKIT/i },
  { name: 'GraphQL', body: /__schema|graphql-playground|graphiql/i },
  { name: 'Swagger / OpenAPI', body: /swagger-ui|openapi":\s*"3\./i },
];

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

export function auditSecurityHeaders(headers: Record<string, string>): SecurityIssue[] {
  const h = lowerHeaders(headers);
  const issues: SecurityIssue[] = [];

  for (const name of PROTECTIVE_HEADERS) {
    if (!(name in h)) {
      const severity: SecurityIssue['severity'] =
        name === 'content-security-policy' || name === 'strict-transport-security' ? 'medium' : 'low';
      issues.push({ header: name, issue: 'missing', severity });
    }
  }

  const csp = h['content-security-policy'];
  if (csp) {
    const low = csp.toLowerCase();
    if (low.includes('unsafe-inline')) issues.push({ header: 'content-security-policy', issue: 'unsafe-inline', severity: 'medium' });
    if (low.includes('unsafe-eval')) issues.push({ header: 'content-security-policy', issue: 'unsafe-eval', severity: 'medium' });
  }

  const hsts = h['strict-transport-security'];
  if (hsts) {
    const m = hsts.toLowerCase().match(/max-age\s*=\s*(\d+)/);
    if (!m || Number(m[1]) < MIN_HSTS_MAX_AGE) {
      issues.push({ header: 'strict-transport-security', issue: 'max-age below 6 months', severity: 'low' });
    }
  }

  const nosniff = h['x-content-type-options'];
  if (nosniff && nosniff.trim().toLowerCase() !== 'nosniff') {
    issues.push({ header: 'x-content-type-options', issue: 'expected nosniff', severity: 'low' });
  }

  for (const name of DISCLOSURE_HEADERS) {
    if (name in h) {
      issues.push({ header: name, issue: `discloses version (${h[name]})`, severity: 'info' });
    }
  }

  return issues;
}

export function decodeJwtTokens(text: string): DecodedJwt[] {
  const seen = new Set<string>();
  const out: DecodedJwt[] = [];
  const re = /\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{0,128}\b/g;
  const nowSecs = Math.floor(Date.now() / 1000);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    if (seen.has(token)) continue;
    seen.add(token);
    const parts = token.split('.');
    if (parts.length !== 3) continue;
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
      const issues: string[] = [];
      if (typeof header.alg === 'string' && header.alg.toLowerCase() === 'none') {
        issues.push('alg is none');
      }
      if (typeof payload.exp === 'number' && payload.exp < nowSecs) {
        issues.push('token is expired');
      }
      out.push({
        rawPrefix: `${token.slice(0, 24)}...`,
        header,
        payload,
        issues,
      });
      if (out.length >= 25) break;
    } catch {}
  }
  return out;
}

export function shannonEntropy(input: string): number {
  if (!input) return 0;
  const freq = new Map<string, number>();
  for (const ch of input) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / input.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function redactSecret(secret: string): string {
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function scanSecretsWithEntropy(text: string): SecretHit[] {
  const seen = new Set<string>();
  const hits: SecretHit[] = [];
  for (const rule of SECRET_PATTERNS) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const matched = m[rule.group];
      if (!matched) continue;
      const entropy = shannonEntropy(matched);
      if (rule.minEntropy > 0 && entropy < rule.minEntropy) continue;
      const key = `${rule.id}:${matched}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        ruleId: rule.id,
        kind: rule.kind,
        preview: redactSecret(matched),
        entropy: Number(entropy.toFixed(2)),
      });
      if (hits.length >= 50) return hits;
    }
  }
  return hits;
}

export function classifyEndpoint(
  method: string,
  rawUrl: string,
  reqContentType = '',
  respContentType = '',
): 'rest' | 'graphql' | 'soap' | 'xhr' | null {
  const m = (method || 'GET').trim().toUpperCase();
  const req = reqContentType.toLowerCase();
  const resp = respContentType.toLowerCase();
  let pathname = '';
  try {
    pathname = new URL(rawUrl).pathname.toLowerCase();
  } catch {
    pathname = rawUrl.toLowerCase();
  }

  if (req.includes('application/soap+xml') || resp.includes('application/soap+xml') || pathname.endsWith('.asmx') || pathname.endsWith('.wsdl')) {
    return 'soap';
  }
  if (pathname.split('/').includes('graphql') || req.includes('application/graphql') || resp.includes('application/graphql')) {
    return 'graphql';
  }
  const isJson = req.includes('application/json') || resp.includes('application/json');
  const isXml = req.includes('application/xml') || resp.includes('application/xml');
  const isForm = req.includes('application/x-www-form-urlencoded') || req.includes('multipart/form-data');
  const hasApiPath = ['/api/', '/v1/', '/v2/', '/v3/', '/rest/', '/rpc/', '/jsonrpc', '/.well-known/', '/oauth/', '/openapi'].some((p) =>
    pathname.includes(p),
  );
  const mutating = m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
  if ((isJson || isXml) && (mutating || hasApiPath)) return 'rest';
  if (isJson && m === 'GET') return 'xhr';
  if (isForm && mutating) return 'rest';
  return null;
}

export function detectTechnologiesOffline(headers: Record<string, string>, body: string): string[] {
  const h = lowerHeaders(headers);
  const found = new Set<string>();
  for (const rule of TECH_RULES) {
    if (rule.header) {
      const [key, re] = rule.header;
      const val = h[key];
      if (val !== undefined && (!re || re.test(val))) found.add(rule.name);
    } else if (rule.body && rule.body.test(body)) {
      found.add(rule.name);
    }
  }
  return Array.from(found).sort();
}

export function auditResponsePassive(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  reqContentType?: string;
  body?: string;
  extractLinks?: boolean;
}): PassiveAuditReport {
  const headers = lowerHeaders(input.headers || {});
  const body = input.body || '';
  const respCt = headers['content-type'] || '';
  const reqCt = input.reqContentType || '';

  const emails: string[] = [];
  const emailSeen = new Set<string>();
  for (const m of body.matchAll(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi)) {
    const val = m[0];
    if (!emailSeen.has(val)) {
      emailSeen.add(val);
      emails.push(val);
      if (emails.length >= 30) break;
    }
  }

  const comments: string[] = [];
  const commentSeen = new Set<string>();
  for (const m of body.matchAll(/<!--([\s\S]*?)-->/g)) {
    const trimmed = m[1].replace(/\s+/g, ' ').trim();
    if (trimmed && !trimmed.startsWith('[') && !commentSeen.has(trimmed)) {
      commentSeen.add(trimmed);
      comments.push(trimmed);
      if (comments.length >= 30) break;
    }
  }

  const report: PassiveAuditReport = {
    url: input.url,
    securityHeaders: auditSecurityHeaders(headers),
    jwtTokens: decodeJwtTokens(body),
    secrets: scanSecretsWithEntropy(body),
    endpointClass: classifyEndpoint(input.method || 'GET', input.url, reqCt, respCt),
    technologies: detectTechnologiesOffline(headers, body),
    emails,
    comments,
  };

  if (input.extractLinks) {
    report.links = parseResponseLinks(input.url, headers, body, true);
    report.forms = extractFormsFromHtml(input.url, body);
  }

  return report;
}
