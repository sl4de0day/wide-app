use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::LazyLock;

use base64::Engine as _;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Map, Value};
use url::Url;

const PROTECTIVE_HEADERS: [&str; 7] = [
    "content-security-policy",
    "strict-transport-security",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "cross-origin-opener-policy",
];

const DISCLOSURE_HEADERS: [&str; 3] = ["server", "x-powered-by", "x-aspnet-version"];
const MIN_HSTS_MAX_AGE: u64 = 15_552_000;

static JWT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b").expect("jwt regex")
});
static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b").expect("email regex")
});
static COMMENT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<!--(.*?)-->").expect("comment regex"));

struct SecretRule {
    id: &'static str,
    kind: &'static str,
    re: Regex,
    group: usize,
    min_entropy: f64,
}

static SECRET_RULES: LazyLock<Vec<SecretRule>> = LazyLock::new(|| {
    let r = |p: &str| Regex::new(p).expect("secret regex");
    vec![
        SecretRule { id: "aws-access-key-id", kind: "AWS Access Key ID", re: r(r"\b(?:AKIA|ASIA|AGPA|AIDA)[0-9A-Z]{16}\b"), group: 0, min_entropy: 0.0 },
        SecretRule { id: "google-api-key", kind: "Google API Key", re: r(r"\bAIza[0-9A-Za-z_\-]{35}\b"), group: 0, min_entropy: 0.0 },
        SecretRule { id: "github-token", kind: "GitHub Token", re: r(r"\b(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{36,})\b"), group: 0, min_entropy: 0.0 },
        SecretRule { id: "slack-token", kind: "Slack Token", re: r(r"\bxox[baprs]-[0-9A-Za-z-]{10,48}\b"), group: 0, min_entropy: 0.0 },
        SecretRule { id: "stripe-key", kind: "Stripe Secret Key", re: r(r"\b[sr]k_(?:live|test)_[0-9A-Za-z]{24,99}\b"), group: 0, min_entropy: 0.0 },
        SecretRule { id: "sendgrid-key", kind: "SendGrid API Key", re: r(r"\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b"), group: 0, min_entropy: 0.0 },
        SecretRule { id: "npm-token", kind: "npm Token", re: r(r"\bnpm_[A-Za-z0-9]{36}\b"), group: 0, min_entropy: 0.0 },
        SecretRule { id: "private-key", kind: "Private Key", re: r(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"), group: 0, min_entropy: 0.0 },
        SecretRule {
            id: "generic-secret",
            kind: "Generic High-Entropy Secret",
            re: r(r#"(?i)(?:api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|client[_-]?secret)["'\s]*[:=]["'\s]*([A-Za-z0-9+/_\-.]{16,})"#),
            group: 1,
            min_entropy: 3.5,
        },
    ]
});

enum TechMatcher {
    Header(&'static str, Regex),
    HeaderPresent(&'static str),
    Body(Regex),
}

struct TechRule {
    name: &'static str,
    matcher: TechMatcher,
}

static TECH_RULES: LazyLock<Vec<TechRule>> = LazyLock::new(|| {
    let header = |name, key, pat| TechRule { name, matcher: TechMatcher::Header(key, Regex::new(pat).expect("tech h")) };
    let present = |name, key| TechRule { name, matcher: TechMatcher::HeaderPresent(key) };
    let body = |name, pat| TechRule { name, matcher: TechMatcher::Body(Regex::new(pat).expect("tech b")) };
    vec![
        header("Nginx", "server", r"(?i)nginx"),
        header("Apache", "server", r"(?i)apache"),
        header("Microsoft-IIS", "server", r"(?i)iis|microsoft-iis"),
        header("OpenResty", "server", r"(?i)openresty"),
        header("Gunicorn", "server", r"(?i)gunicorn"),
        header("Cloudflare", "server", r"(?i)cloudflare"),
        present("Cloudflare", "cf-ray"),
        present("Varnish", "x-varnish"),
        header("PHP", "x-powered-by", r"(?i)php"),
        header("Express", "x-powered-by", r"(?i)express"),
        header("ASP.NET", "x-powered-by", r"(?i)asp\.net"),
        present("ASP.NET", "x-aspnet-version"),
        header("Next.js", "x-powered-by", r"(?i)next\.js"),
        header("Drupal", "x-generator", r"(?i)drupal"),
        body("WordPress", r"(?i)wp-content|wp-includes|<meta[^>]+wordpress"),
        body("Drupal", r"(?i)drupal\.settings|/sites/(all|default)/"),
        body("Next.js", r"(?i)/_next/static|__NEXT_DATA__"),
        body("React", r"(?i)data-reactroot|react(-dom)?(\.min)?\.js"),
        body("Vue.js", r"(?i)data-v-[0-9a-f]{8}|vue(\.min)?\.js"),
        body("Angular", r"(?i)ng-version|angular(\.min)?\.js"),
        body("jQuery", r"(?i)jquery[-.][0-9]|jquery(\.min)?\.js"),
        body("Bootstrap", r"(?i)bootstrap(\.min)?\.(css|js)"),
        body("Google Analytics", r"(?i)google-analytics\.com|gtag\(|googletagmanager\.com"),
    ]
});

#[derive(Debug, Clone, Serialize)]
pub struct SecretFinding {
    pub rule: &'static str,
    pub kind: &'static str,
    pub masked: String,
    pub entropy: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PassiveAuditReport {
    pub url: String,
    pub security_headers: Value,
    pub jwt_tokens: Vec<Value>,
    pub secrets: Vec<SecretFinding>,
    pub endpoint_class: Option<String>,
    pub technologies: Vec<String>,
    pub emails: Vec<String>,
    pub comments: Vec<String>,
}

#[must_use]
pub fn normalize_headers(headers: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    headers.iter().map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())).collect()
}

#[must_use]
pub fn audit_security_headers(headers: &BTreeMap<String, String>) -> Value {
    let lower = normalize_headers(headers);
    let missing: Vec<&str> = PROTECTIVE_HEADERS.iter().copied().filter(|h| !lower.contains_key(*h)).collect();
    let mut issues: Vec<String> = Vec::new();

    if let Some(hsts) = lower.get("strict-transport-security") {
        let age = hsts
            .to_ascii_lowercase()
            .split("max-age")
            .nth(1)
            .and_then(|s| s.trim_start().strip_prefix('='))
            .map(|s| s.trim_start().chars().take_while(char::is_ascii_digit).collect::<String>())
            .and_then(|d| d.parse::<u64>().ok());
        match age {
            None | Some(0) => issues.push("strict-transport-security present but max-age is missing or zero".to_string()),
            Some(v) if v < MIN_HSTS_MAX_AGE => issues.push(format!("strict-transport-security max-age {v} is below recommended 15552000")),
            Some(_) => {}
        }
    }

    if let Some(val) = lower.get("x-content-type-options") {
        if !val.eq_ignore_ascii_case("nosniff") {
            issues.push("x-content-type-options present but value is not \"nosniff\"".to_string());
        }
    }

    if let Some(csp) = lower.get("content-security-policy") {
        let l = csp.to_ascii_lowercase();
        if l.contains("unsafe-inline") {
            issues.push("content-security-policy allows unsafe-inline".to_string());
        }
        if l.contains("unsafe-eval") {
            issues.push("content-security-policy allows unsafe-eval".to_string());
        }
    }

    if let Some(xfo) = lower.get("x-frame-options") {
        if !xfo.eq_ignore_ascii_case("DENY") && !xfo.eq_ignore_ascii_case("SAMEORIGIN") {
            issues.push(format!("x-frame-options value {xfo:?} is neither DENY nor SAMEORIGIN"));
        }
    }

    let mut disclosure = Map::new();
    for name in DISCLOSURE_HEADERS {
        if let Some(v) = lower.get(name) {
            disclosure.insert(name.to_string(), json!(v));
        }
    }

    let mut out = Map::new();
    if !missing.is_empty() {
        out.insert("missing".to_string(), json!(missing));
    }
    if !issues.is_empty() {
        out.insert("issues".to_string(), json!(issues));
    }
    if !disclosure.is_empty() {
        out.insert("disclosure".to_string(), Value::Object(disclosure));
    }
    Value::Object(out)
}

#[must_use]
pub fn decode_jwt_tokens(body: &str) -> Vec<Value> {
    let mut seen = HashSet::new();
    let mut tokens = Vec::new();
    for m in JWT_RE.find_iter(body) {
        let raw = m.as_str();
        if !seen.insert(raw) {
            continue;
        }
        let mut parts = raw.split('.');
        let (Some(h_raw), Some(p_raw)) = (parts.next(), parts.next()) else { continue };
        let Some(header) = decode_b64_json(h_raw) else { continue };
        let Some(payload) = decode_b64_json(p_raw) else { continue };
        let alg = header.get("alg").and_then(Value::as_str).unwrap_or("?");
        tokens.push(json!({
            "alg": alg,
            "masked": mask_token(raw),
            "iss": payload.get("iss"),
            "sub": payload.get("sub"),
            "aud": payload.get("aud"),
            "exp": payload.get("exp"),
            "iat": payload.get("iat"),
            "claims": payload,
        }));
        if tokens.len() >= 20 {
            break;
        }
    }
    tokens
}

fn decode_b64_json(seg: &str) -> Option<Value> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(seg).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn mask_token(raw: &str) -> String {
    let n = raw.len();
    if n <= 12 { "*".repeat(n) } else { format!("{}...{}", &raw[..8], &raw[n - 4..]) }
}

#[must_use]
pub fn shannon_entropy(s: &str) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    let mut freq: BTreeMap<u8, usize> = BTreeMap::new();
    for b in s.as_bytes() {
        *freq.entry(*b).or_insert(0) += 1;
    }
    let len = s.len() as f64;
    freq.values()
        .map(|&c| {
            let p = c as f64 / len;
            -p * p.log2()
        })
        .sum()
}

#[must_use]
pub fn scan_secrets(body: &str) -> Vec<SecretFinding> {
    if body.is_empty() {
        return Vec::new();
    }
    let mut findings = Vec::new();
    let mut seen = HashSet::new();
    for rule in SECRET_RULES.iter() {
        for caps in rule.re.captures_iter(body) {
            let Some(m) = caps.get(rule.group).or_else(|| caps.get(0)) else { continue };
            let secret = m.as_str();
            let ent = shannon_entropy(secret);
            if rule.min_entropy > 0.0 && ent < rule.min_entropy {
                continue;
            }
            if !seen.insert(format!("{}:{secret}", rule.id)) {
                continue;
            }
            findings.push(SecretFinding {
                rule: rule.id,
                kind: rule.kind,
                masked: mask_token(secret),
                entropy: (ent * 100.0).round() / 100.0,
            });
            if findings.len() >= 50 {
                return findings;
            }
        }
    }
    findings
}

#[must_use]
pub fn classify_endpoint(method: &str, url: &Url, req_ct: &str, resp_ct: &str) -> Option<&'static str> {
    let m = method.to_ascii_uppercase();
    let path = url.path().to_ascii_lowercase();
    let req = req_ct.to_ascii_lowercase();
    let resp = resp_ct.to_ascii_lowercase();
    if req.contains("soap+xml") || resp.contains("soap+xml") {
        return Some("soap");
    }
    if path.split('/').any(|s| s == "graphql") || req.contains("application/graphql") || resp.contains("application/graphql") {
        return Some("graphql");
    }
    let is_json = req.contains("application/json") || resp.contains("application/json");
    let is_xml = req.contains("application/xml") || resp.contains("application/xml");
    let is_form = req.contains("application/x-www-form-urlencoded") || req.contains("multipart/form-data");
    let api = ["/api/", "/v1/", "/v2/", "/v3/", "/rest/", "/rpc/", "/jsonrpc", "/.well-known/", "/oauth/", "/openapi"]
        .iter()
        .any(|s| path.contains(s));
    let mutating = matches!(m.as_str(), "POST" | "PUT" | "PATCH" | "DELETE");
    if (is_json || is_xml) && (mutating || api) {
        return Some("rest");
    }
    if is_json && m == "GET" {
        return Some("xhr");
    }
    if is_form && mutating {
        return Some("rest");
    }
    None
}

#[must_use]
pub fn detect_tech(headers: &BTreeMap<String, String>, body: &str) -> Vec<String> {
    let lower = normalize_headers(headers);
    let mut found = BTreeSet::new();
    for rule in TECH_RULES.iter() {
        let matched = match &rule.matcher {
            TechMatcher::Header(key, re) => lower.get(*key).is_some_and(|v| re.is_match(v)),
            TechMatcher::HeaderPresent(key) => lower.contains_key(*key),
            TechMatcher::Body(re) => re.is_match(body),
        };
        if matched {
            found.insert(rule.name.to_string());
        }
    }
    found.into_iter().collect()
}

#[must_use]
pub fn audit_response_passive(
    url: &Url,
    method: &str,
    headers: &BTreeMap<String, String>,
    req_content_type: &str,
    body: &str,
) -> PassiveAuditReport {
    let lower = normalize_headers(headers);
    let resp_ct = lower.get("content-type").map_or("", String::as_str);

    let mut emails = Vec::new();
    let mut email_seen = HashSet::new();
    for m in EMAIL_RE.find_iter(body) {
        let val = m.as_str().to_string();
        if email_seen.insert(val.clone()) {
            emails.push(val);
            if emails.len() >= 30 {
                break;
            }
        }
    }

    let mut comments = Vec::new();
    let mut comment_seen = HashSet::new();
    for caps in COMMENT_RE.captures_iter(body) {
        if let Some(m) = caps.get(1) {
            let trimmed = m.as_str().split_whitespace().collect::<Vec<_>>().join(" ");
            if !trimmed.is_empty() && !trimmed.starts_with('[') && comment_seen.insert(trimmed.clone()) {
                comments.push(trimmed);
                if comments.len() >= 30 {
                    break;
                }
            }
        }
    }

    PassiveAuditReport {
        url: url.to_string(),
        security_headers: audit_security_headers(&lower),
        jwt_tokens: decode_jwt_tokens(body),
        secrets: scan_secrets(body),
        endpoint_class: classify_endpoint(method, url, req_content_type, resp_ct).map(str::to_string),
        technologies: detect_tech(&lower, body),
        emails,
        comments,
    }
}
