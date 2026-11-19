mod crawler;
mod state_graph;

use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};

use serde::{Deserialize, Serialize};
use url::Url;
use wide_http_core::client::{HttpClient, HttpClientConfig};
use wide_http_core::tls::ImpersonateProfile;
use wide_recon_core::analyzers::audit_response_passive;
use wide_recon_core::filters::{fingerprint_url, PathTrie};
use wide_recon_core::parser::{extract_forms, parse_response_links};
use wide_recon_core::scope::{is_internal_host, NetworkPolicy, ScopeManager};

use crate::crawler::{run_crawl, CrawlConfig};
use crate::state_graph::StateGraph;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditInput {
    url: String,
    #[serde(default = "default_get")]
    method: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    req_content_type: String,
    #[serde(default)]
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NormalizeInput {
    urls: Vec<String>,
    #[serde(default = "default_threshold")]
    threshold: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckScopeInput {
    url: String,
    root_hostname: String,
    #[serde(default = "default_rdn")]
    field_scope: String,
    #[serde(default)]
    in_scope: Vec<String>,
    #[serde(default)]
    out_scope: Vec<String>,
    #[serde(default)]
    exclude: Vec<String>,
    #[serde(default)]
    allow_private: bool,
    #[serde(default)]
    no_scope: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestInput {
    #[serde(default = "default_get")]
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    tls_profile: String,
    #[serde(default)]
    allow_private: bool,
    #[serde(default = "default_timeout")]
    timeout_secs: u64,
    #[serde(default = "default_retries")]
    retries: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateGraphInput {
    transitions: Vec<GraphTransitionInput>,
    #[serde(default = "default_sim_threshold")]
    threshold: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphTransitionInput {
    from_url: Option<String>,
    to_url: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    status: u16,
    #[serde(default)]
    depth: u32,
    #[serde(default)]
    body: String,
    #[serde(default)]
    action: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "kebab-case")]
enum Command {
    Crawl(CrawlConfig),
    Audit(AuditInput),
    Normalize(NormalizeInput),
    CheckScope(CheckScopeInput),
    Request(RequestInput),
    StateGraph(StateGraphInput),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestOutput {
    status: u16,
    final_url: String,
    headers: BTreeMap<String, String>,
    body: String,
    content_length: usize,
    elapsed_ms: u64,
}

fn default_get() -> String {
    "GET".to_string()
}

fn default_threshold() -> usize {
    10
}

fn default_rdn() -> String {
    "rdn".to_string()
}

fn default_timeout() -> u64 {
    15
}

fn default_retries() -> u32 {
    1
}

fn default_sim_threshold() -> u32 {
    4
}

fn emit_json<T: Serialize>(value: &T) {
    let Ok(line) = serde_json::to_string(value) else { return };
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

#[tokio::main]
async fn main() {
    let stdin = io::stdin();
    let mut raw = String::new();
    for line in stdin.lock().lines() {
        let Ok(l) = line else { break };
        raw.push_str(&l);
        raw.push('\n');
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        eprintln!("expected JSON command on stdin");
        std::process::exit(2);
    }

    let cmd: Command = match serde_json::from_str(trimmed) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("invalid command JSON: {e}");
            std::process::exit(2);
        }
    };

    match cmd {
        Command::Crawl(cfg) => {
            if let Err(err) = run_crawl(cfg, |ev| emit_json(&ev)).await {
                eprintln!("{err}");
                std::process::exit(1);
            }
        }
        Command::Audit(input) => {
            let Ok(parsed) = Url::parse(&input.url) else {
                eprintln!("invalid URL: {}", input.url);
                std::process::exit(2);
            };
            let report = audit_response_passive(
                &parsed,
                &input.method,
                &input.headers,
                &input.req_content_type,
                &input.body,
            );
            let links = parse_response_links(&parsed, &input.headers, &input.body, true);
            let forms = extract_forms(&parsed, &input.body);
            emit_json(&serde_json::json!({
                "audit": report,
                "links": links,
                "forms": forms,
            }));
        }
        Command::Normalize(input) => {
            let trie = PathTrie::new(input.threshold);
            let fingerprints: Vec<String> = input
                .urls
                .iter()
                .map(|u| fingerprint_url(u, Some(&trie)))
                .collect();
            emit_json(&serde_json::json!({ "fingerprints": fingerprints }));
        }
        Command::CheckScope(input) => {
            let Ok(parsed) = Url::parse(&input.url) else {
                eprintln!("invalid URL: {}", input.url);
                std::process::exit(2);
            };
            let mgr = match ScopeManager::new(
                &input.field_scope,
                &input.in_scope,
                &input.out_scope,
                &input.exclude,
                input.allow_private,
                input.no_scope,
            ) {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(2);
                }
            };
            let allowed = mgr.validate(&parsed, &input.root_hostname);
            let internal_host = parsed.host_str().is_some_and(is_internal_host);
            let normalized = fingerprint_url(parsed.as_str(), None);
            emit_json(&serde_json::json!({
                "allowed": allowed,
                "internalHost": internal_host,
                "normalized": normalized,
            }));
        }
        Command::Request(input) => {
            let Ok(parsed) = Url::parse(&input.url) else {
                eprintln!("invalid URL: {}", input.url);
                std::process::exit(2);
            };
            let net = NetworkPolicy {
                allow_private: input.allow_private,
                allow_non_http: false,
            };
            if !net.allows(&parsed) {
                eprintln!("URL blocked by SSRF network policy: {}", input.url);
                std::process::exit(3);
            }
            let client = match HttpClient::new(&HttpClientConfig {
                timeout_secs: input.timeout_secs.max(1),
                retries: input.retries,
                max_redirects: 8,
                disable_redirects: false,
                body_read_size: 2 * 1024 * 1024,
                tls_profile: ImpersonateProfile::parse(&input.tls_profile),
                custom_headers: Vec::new(),
            }) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            };
            match client
                .request(&input.method, &parsed, &input.headers, input.body.as_deref())
                .await
            {
                Ok(resp) => emit_json(&HttpRequestOutput {
                    status: resp.status,
                    final_url: resp.final_url.to_string(),
                    headers: resp.headers,
                    body: resp.body,
                    content_length: resp.content_length,
                    elapsed_ms: resp.elapsed_ms,
                }),
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            }
        }
        Command::StateGraph(input) => {
            let mut g = StateGraph::new(input.threshold);
            for t in input.transitions {
                g.record_transition(
                    t.from_url.as_deref(),
                    &t.to_url,
                    &t.title,
                    t.status,
                    t.depth,
                    t.body.as_bytes(),
                    &t.action,
                );
            }
            emit_json(&g.snapshot());
        }
    }
}
