use std::collections::{BTreeMap, VecDeque};
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use governor::{clock::DefaultClock, state::direct::NotKeyed, Quota, RateLimiter};
use serde::{Deserialize, Serialize};
use url::Url;
use wide_http_core::backoff::{is_throttled, parse_retry_after, HostBackoff};
use wide_http_core::client::{HttpClient, HttpClientConfig};
use wide_http_core::tls::ImpersonateProfile;
use wide_recon_core::analyzers::{audit_response_passive, PassiveAuditReport};
use wide_recon_core::filters::{fingerprint_url, ExtensionValidator, PathTrie, UniqueFilter};
use wide_recon_core::parser::{
    extract_forms, parse_response_links, parse_robots_entries, parse_robots_rules, parse_sitemap_entries,
    FormInfo, RobotsRules,
};
use wide_recon_core::scope::ScopeManager;
use wide_recon_core::similarity::{LexicalIndex, LexicalMode, SimHashIndex};

use crate::state_graph::{StateGraph, StateGraphSnapshot};

const COMMON_PROBE_PATHS: &[&str] = &[
    "/robots.txt",
    "/sitemap.xml",
    "/.well-known/security.txt",
    "/graphql",
    "/swagger.json",
    "/openapi.json",
    "/api-docs",
    "/.env",
    "/.git/HEAD",
    "/admin",
    "/login",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CrawlConfig {
    pub seeds: Vec<String>,
    pub max_depth: u32,
    pub max_pages: usize,
    pub concurrency: usize,
    pub rate_limit: Option<u32>,
    pub timeout_secs: u64,
    pub retries: u32,
    pub js_crawl: bool,
    pub robots_and_sitemap: bool,
    pub probe_paths: bool,
    pub path_climb: bool,
    pub filter_similar: bool,
    pub use_bm25: bool,
    pub simhash_distance: u32,
    pub field_scope: String,
    pub in_scope: Vec<String>,
    pub out_scope: Vec<String>,
    pub exclude: Vec<String>,
    pub allow_private: bool,
    pub no_scope: bool,
    pub ignore_extensions: bool,
    pub match_extensions: Vec<String>,
    pub filter_extensions: Vec<String>,
    pub tls_profile: String,
    pub headers: Vec<(String, String)>,
}

impl Default for CrawlConfig {
    fn default() -> Self {
        CrawlConfig {
            seeds: Vec::new(),
            max_depth: 3,
            max_pages: 200,
            concurrency: 10,
            rate_limit: None,
            timeout_secs: 15,
            retries: 1,
            js_crawl: true,
            robots_and_sitemap: true,
            probe_paths: true,
            path_climb: false,
            filter_similar: true,
            use_bm25: false,
            simhash_distance: 8,
            field_scope: "rdn".to_string(),
            in_scope: Vec::new(),
            out_scope: Vec::new(),
            exclude: Vec::new(),
            allow_private: false,
            no_scope: false,
            ignore_extensions: false,
            match_extensions: Vec::new(),
            filter_extensions: Vec::new(),
            tls_profile: "none".to_string(),
            headers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrawledPage {
    pub url: String,
    pub final_url: String,
    pub fingerprint: String,
    pub status: u16,
    pub depth: u32,
    pub title: String,
    pub content_type: String,
    pub content_length: usize,
    pub elapsed_ms: u64,
    pub links: Vec<String>,
    pub forms: Vec<FormInfo>,
    pub audit: PassiveAuditReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CrawlEvent {
    Progress { visited: usize, queued: usize, active: usize },
    Page { page: Box<CrawledPage> },
    Done { visited: usize, pages: usize, graph: StateGraphSnapshot },
    Error { url: String, message: String },
}

#[derive(Debug, Clone)]
struct CrawlItem {
    url: Url,
    depth: u32,
    parent_url: Option<String>,
    action: String,
}

type SharedLimiter = RateLimiter<NotKeyed, governor::state::InMemoryState, DefaultClock>;

enum SimilarityFilter {
    SimHash(SimHashIndex),
    Bm25(LexicalIndex),
}

impl SimilarityFilter {
    fn accept(&self, body: &[u8]) -> bool {
        match self {
            SimilarityFilter::SimHash(idx) => idx.accept(body),
            SimilarityFilter::Bm25(idx) => idx.accept(&String::from_utf8_lossy(body)),
        }
    }
}

struct CrawlContext {
    client: HttpClient,
    scope: ScopeManager,
    root_hostname: String,
    ext: ExtensionValidator,
    ignore_extensions: bool,
    unique: UniqueFilter,
    trie: PathTrie,
    similarity: Option<SimilarityFilter>,
    backoff: HostBackoff,
    limiter: Option<SharedLimiter>,
    frontier: Mutex<VecDeque<CrawlItem>>,
    robots: Mutex<BTreeMap<String, RobotsRules>>,
    graph: Mutex<StateGraph>,
    visited_count: AtomicUsize,
    emitted_count: AtomicUsize,
    active_count: AtomicUsize,
    stop: AtomicBool,
    cfg: CrawlConfig,
}

pub async fn run_crawl<F>(cfg: CrawlConfig, mut on_event: F) -> Result<(), String>
where
    F: FnMut(CrawlEvent) + Send,
{
    if cfg.seeds.is_empty() {
        return Err("at least one seed URL is required".to_string());
    }
    let mut parsed_seeds = Vec::new();
    for raw in &cfg.seeds {
        let u = Url::parse(raw.trim()).map_err(|e| format!("invalid seed URL {raw:?}: {e}"))?;
        parsed_seeds.push(u);
    }
    let root_hostname = parsed_seeds[0].host_str().unwrap_or_default().to_string();
    let scope = ScopeManager::new(
        &cfg.field_scope,
        &cfg.in_scope,
        &cfg.out_scope,
        &cfg.exclude,
        cfg.allow_private,
        cfg.no_scope,
    )?;
    for seed in &parsed_seeds {
        if !scope.validate(seed, &root_hostname) {
            return Err(format!("seed URL blocked by scope or SSRF policy: {seed}"));
        }
    }
    let client = HttpClient::new(&HttpClientConfig {
        timeout_secs: cfg.timeout_secs.max(1),
        retries: cfg.retries,
        max_redirects: 8,
        disable_redirects: false,
        body_read_size: 2 * 1024 * 1024,
        tls_profile: ImpersonateProfile::parse(&cfg.tls_profile),
        custom_headers: cfg.headers.clone(),
    })?;
    let ext = ExtensionValidator::new(&cfg.match_extensions, &cfg.filter_extensions, false);
    let similarity = if cfg.filter_similar {
        if cfg.use_bm25 {
            Some(SimilarityFilter::Bm25(LexicalIndex::new(LexicalMode::Bm25, 0.85, 256)))
        } else {
            Some(SimilarityFilter::SimHash(SimHashIndex::new(cfg.simhash_distance, 3)))
        }
    } else {
        None
    };
    let limiter = cfg.rate_limit.and_then(NonZeroU32::new).map(|rps| RateLimiter::direct(Quota::per_second(rps)));
    let unique = UniqueFilter::new(false);
    let trie = PathTrie::new(10);
    let mut initial = VecDeque::new();

    for seed in &parsed_seeds {
        if enqueue_item(&scope, &root_hostname, &ext, cfg.ignore_extensions, &unique, &trie, seed.clone(), 0, None, "seed", &mut initial) && cfg.path_climb {
            for parent in climbed_paths(seed) {
                enqueue_item(&scope, &root_hostname, &ext, cfg.ignore_extensions, &unique, &trie, parent, 1, Some(seed.to_string()), "path-climb", &mut initial);
            }
        }
        if cfg.probe_paths {
            if let Ok(origin) = seed.join("/") {
                for probe in COMMON_PROBE_PATHS {
                    if let Ok(u) = origin.join(probe) {
                        enqueue_item(&scope, &root_hostname, &ext, cfg.ignore_extensions, &unique, &trie, u, 1, Some(seed.to_string()), "probe", &mut initial);
                    }
                }
            }
        }
    }

    let ctx = Arc::new(CrawlContext {
        client,
        scope,
        root_hostname,
        ext,
        ignore_extensions: cfg.ignore_extensions,
        unique,
        trie,
        similarity,
        backoff: HostBackoff::new(),
        limiter,
        frontier: Mutex::new(initial),
        robots: Mutex::new(BTreeMap::new()),
        graph: Mutex::new(StateGraph::new(4)),
        visited_count: AtomicUsize::new(0),
        emitted_count: AtomicUsize::new(0),
        active_count: AtomicUsize::new(0),
        stop: AtomicBool::new(false),
        cfg: cfg.clone(),
    });

    if cfg.robots_and_sitemap {
        seed_robots_and_sitemaps(&ctx, &parsed_seeds).await;
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<CrawlEvent>(256);
    let worker_count = cfg.concurrency.clamp(1, 32);
    let mut handles = Vec::with_capacity(worker_count);
    for _ in 0..worker_count {
        let c = Arc::clone(&ctx);
        let worker_tx = tx.clone();
        handles.push(tokio::spawn(async move {
            worker_loop(c, worker_tx).await;
        }));
    }
    drop(tx);

    while let Some(ev) = rx.recv().await {
        on_event(ev);
    }
    for h in handles {
        let _ = h.await;
    }

    let graph = ctx.graph.lock().unwrap_or_else(std::sync::PoisonError::into_inner).snapshot();
    on_event(CrawlEvent::Done {
        visited: ctx.visited_count.load(Ordering::Relaxed),
        pages: ctx.emitted_count.load(Ordering::Relaxed),
        graph,
    });
    Ok(())
}

async fn seed_robots_and_sitemaps(ctx: &CrawlContext, seeds: &[Url]) {
    let mut seen_origins = BTreeMap::new();
    for seed in seeds {
        if let Some(host) = seed.host_str() {
            if let Ok(origin) = seed.join("/") {
                seen_origins.insert(host.to_ascii_lowercase(), origin);
            }
        }
    }
    for (host, origin) in seen_origins {
        if let Ok(robots_url) = origin.join("/robots.txt") {
            if let Ok(resp) = ctx.client.get(&robots_url).await {
                if resp.status < 400 {
                    let rules = parse_robots_rules(&resp.body, &["widebot", "mozilla", "*"]);
                    ctx.robots.lock().unwrap_or_else(std::sync::PoisonError::into_inner).insert(host.clone(), rules);
                    let entries = parse_robots_entries(&robots_url, &resp.body);
                    let mut front = ctx.frontier.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    for link in entries {
                        if let Ok(u) = Url::parse(&link.url) {
                            enqueue_item(&ctx.scope, &ctx.root_hostname, &ctx.ext, ctx.ignore_extensions, &ctx.unique, &ctx.trie, u, 1, Some(robots_url.to_string()), "robots", &mut front);
                        }
                    }
                }
            }
        }
        if let Ok(sitemap_url) = origin.join("/sitemap.xml") {
            if let Ok(resp) = ctx.client.get(&sitemap_url).await {
                if resp.status < 400 {
                    let entries = parse_sitemap_entries(&sitemap_url, &resp.body);
                    let mut front = ctx.frontier.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    for link in entries {
                        if let Ok(u) = Url::parse(&link.url) {
                            enqueue_item(&ctx.scope, &ctx.root_hostname, &ctx.ext, ctx.ignore_extensions, &ctx.unique, &ctx.trie, u, 1, Some(sitemap_url.to_string()), "sitemap", &mut front);
                        }
                    }
                }
            }
        }
    }
}

async fn worker_loop(ctx: Arc<CrawlContext>, tx: tokio::sync::mpsc::Sender<CrawlEvent>) {
    loop {
        if ctx.stop.load(Ordering::Relaxed) {
            break;
        }
        let next = {
            let mut guard = ctx.frontier.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let item = guard.pop_front();
            if item.is_some() {
                ctx.active_count.fetch_add(1, Ordering::AcqRel);
            }
            item
        };
        let Some(item) = next else {
            if ctx.active_count.load(Ordering::Acquire) == 0 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            continue;
        };

        if ctx.visited_count.load(Ordering::Relaxed) >= ctx.cfg.max_pages {
            ctx.active_count.fetch_sub(1, Ordering::AcqRel);
            ctx.stop.store(true, Ordering::Relaxed);
            break;
        }

        if let Some(host) = item.url.host_str() {
            if !robots_allows(&ctx, host, item.url.path()) {
                ctx.active_count.fetch_sub(1, Ordering::AcqRel);
                continue;
            }
        }
        if let Some(limiter) = &ctx.limiter {
            limiter.until_ready().await;
        }
        let host = item.url.host_str().unwrap_or_default().to_string();
        ctx.backoff.apply(&host).await;

        let resp = match ctx.client.get(&item.url).await {
            Ok(r) => r,
            Err(err) => {
                ctx.active_count.fetch_sub(1, Ordering::AcqRel);
                let _ = tx.send(CrawlEvent::Error { url: item.url.to_string(), message: err }).await;
                continue;
            }
        };

        let visited_now = ctx.visited_count.fetch_add(1, Ordering::AcqRel) + 1;
        if is_throttled(resp.status) {
            ctx.backoff.record_throttle(&host);
            if let Some(secs) = parse_retry_after(&resp.headers) {
                ctx.backoff.record_retry_after(&host, std::time::Duration::from_secs(secs.min(60)));
            }
        } else {
            ctx.backoff.record_success(&host);
        }

        let body_bytes = resp.body.as_bytes();
        let ct = resp.headers.get("content-type").cloned().unwrap_or_default();
        let unique_body = ctx.unique.unique_content(body_bytes);
        let sim_ok = ctx.similarity.as_ref().map_or(true, |sim| sim.accept(body_bytes));

        if unique_body && (sim_ok || item.depth == 0) {
            let discovered = parse_response_links(&resp.final_url, &resp.headers, &resp.body, ctx.cfg.js_crawl);
            let forms = extract_forms(&resp.final_url, &resp.body);
            let req_ct = "";
            let audit = audit_response_passive(&resp.final_url, "GET", &resp.headers, req_ct, &resp.body);
            let title = extract_html_title(&resp.body);
            let fp = fingerprint_url(resp.final_url.as_str(), Some(&ctx.trie));

            let mut link_urls = Vec::with_capacity(discovered.len());
            for link in &discovered {
                link_urls.push(link.url.clone());
                if item.depth < ctx.cfg.max_depth {
                    if let Ok(child) = Url::parse(&link.url) {
                        let mut front = ctx.frontier.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                        enqueue_item(
                            &ctx.scope,
                            &ctx.root_hostname,
                            &ctx.ext,
                            ctx.ignore_extensions,
                            &ctx.unique,
                            &ctx.trie,
                            child,
                            item.depth + 1,
                            Some(item.url.to_string()),
                            &format!("{}:{}", link.source, link.tag),
                            &mut front,
                        );
                    }
                }
            }

            {
                let mut g = ctx.graph.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                g.record_transition(
                    item.parent_url.as_deref(),
                    resp.final_url.as_str(),
                    &title,
                    resp.status,
                    item.depth,
                    body_bytes,
                    &item.action,
                );
            }

            ctx.emitted_count.fetch_add(1, Ordering::Relaxed);
            let page = CrawledPage {
                url: item.url.to_string(),
                final_url: resp.final_url.to_string(),
                fingerprint: fp,
                status: resp.status,
                depth: item.depth,
                title,
                content_type: ct,
                content_length: resp.content_length,
                elapsed_ms: resp.elapsed_ms,
                links: link_urls,
                forms,
                audit,
            };
            let _ = tx.send(CrawlEvent::Page { page: Box::new(page) }).await;
        }

        let queued = ctx.frontier.lock().unwrap_or_else(std::sync::PoisonError::into_inner).len();
        let active = ctx.active_count.fetch_sub(1, Ordering::AcqRel).saturating_sub(1);
        let _ = tx.send(CrawlEvent::Progress { visited: visited_now, queued, active }).await;
        if visited_now >= ctx.cfg.max_pages {
            ctx.stop.store(true, Ordering::Relaxed);
        }
    }
}

fn enqueue_item(
    scope: &ScopeManager,
    root_hostname: &str,
    ext: &ExtensionValidator,
    ignore_extensions: bool,
    unique: &UniqueFilter,
    trie: &PathTrie,
    url: Url,
    depth: u32,
    parent_url: Option<String>,
    action: &str,
    frontier: &mut VecDeque<CrawlItem>,
) -> bool {
    if !scope.validate(&url, root_hostname) {
        return false;
    }
    if !ignore_extensions && !ext.validate(&url) {
        return false;
    }
    let fp = fingerprint_url(url.as_str(), Some(trie));
    if !unique.unique_url(&fp) {
        return false;
    }
    frontier.push_back(CrawlItem {
        url,
        depth,
        parent_url,
        action: action.to_string(),
    });
    true
}

fn robots_allows(ctx: &CrawlContext, host: &str, path: &str) -> bool {
    let guard = ctx.robots.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    guard.get(&host.to_ascii_lowercase()).map_or(true, |r| r.is_allowed(path))
}

fn climbed_paths(seed: &Url) -> Vec<Url> {
    let mut out = Vec::new();
    let segs: Vec<&str> = seed.path().trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    for len in (1..segs.len()).rev() {
        let mut cloned = seed.clone();
        cloned.set_query(None);
        cloned.set_fragment(None);
        cloned.set_path(&format!("/{}/", segs[..len].join("/")));
        out.push(cloned);
    }
    out
}

fn extract_html_title(body: &str) -> String {
    let lower = body.to_ascii_lowercase();
    let Some(start) = lower.find("<title") else { return String::new() };
    let Some(gt) = lower[start..].find('>') else { return String::new() };
    let rest_start = start + gt + 1;
    let Some(end) = lower[rest_start..].find("</title>") else { return String::new() };
    body[rest_start..rest_start + end].split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::{run_crawl, CrawlConfig, CrawlEvent};

    #[tokio::test]
    async fn spider_crawls_mock_server_and_discovers_links_forms_and_audit() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { break };
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let path = req.lines().next().unwrap_or("").split_whitespace().nth(1).unwrap_or("/");
                    let (status, ct, body) = match path {
                        "/" => (
                            "200 OK",
                            "text/html",
                            r#"<!doctype html><html><head><title>Wide Home</title></head><body><a href="/login">Login</a><script>fetch("/api/users");</script></body></html>"#,
                        ),
                        "/login" => (
                            "200 OK",
                            "text/html",
                            r#"<html><head><title>Login</title></head><body><form action="/session" method="POST"><input name="user" type="text"></form></body></html>"#,
                        ),
                        "/api/users" => ("200 OK", "application/json", r#"{"ok":true}"#),
                        "/robots.txt" => ("200 OK", "text/plain", "User-agent: *\nAllow: /\n"),
                        _ => ("404 Not Found", "text/plain", "missing"),
                    };
                    let resp = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: {ct}\r\nServer: Nginx\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                });
            }
        });

        let mut cfg = CrawlConfig::default();
        cfg.seeds = vec![format!("http://127.0.0.1:{port}/")];
        cfg.allow_private = true;
        cfg.probe_paths = false;
        cfg.max_depth = 2;
        cfg.max_pages = 10;
        cfg.concurrency = 2;

        let mut pages = Vec::new();
        let mut done_visited = 0usize;
        let mut graph_nodes = 0usize;
        run_crawl(cfg, |ev| match ev {
            CrawlEvent::Page { page } => pages.push(*page),
            CrawlEvent::Done { visited, graph, .. } => {
                done_visited = visited;
                graph_nodes = graph.nodes.len();
            }
            _ => {}
        })
        .await
        .unwrap();

        assert!(done_visited >= 3);
        assert!(pages.iter().any(|p| p.final_url.ends_with("/login") && !p.forms.is_empty()));
        assert!(pages.iter().any(|p| p.final_url.ends_with("/api/users") && p.audit.endpoint_class.as_deref() == Some("rest")));
        assert!(graph_nodes >= 2);
    }
}
