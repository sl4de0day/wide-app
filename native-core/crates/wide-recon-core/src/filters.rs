use std::collections::{BTreeSet, HashMap, HashSet};
use std::num::NonZeroUsize;
use std::sync::{LazyLock, Mutex};

use dashmap::DashSet;
use lru::LruCache;
use regex::Regex;
use url::Url;

pub const DEFAULT_PATH_TRIE_THRESHOLD: usize = 10;
pub const DEFAULT_PATH_TRIE_MAX_HOSTS: usize = 10_000;

pub const DEFAULT_DENIED_EXTENSIONS: &[&str] = &[
    "3g2", "3gp", "7z", "apk", "arj", "avi", "axd", "bmp", "csv", "deb", "dll", "doc", "drv",
    "eot", "exe", "flv", "gif", "gifv", "gz", "h264", "ico", "iso", "jar", "jpeg", "jpg", "lock",
    "m4a", "m4v", "map", "mkv", "mov", "mp3", "mp4", "mpeg", "mpg", "msi", "ogg", "ogm", "ogv",
    "otf", "pdf", "pkg", "png", "ppt", "psd", "rar", "rm", "rpm", "svg", "swf", "sys", "tar",
    "tif", "tiff", "ttf", "vob", "wav", "webm", "webp", "wmv", "woff", "woff2", "xcf", "xls",
    "xlsx", "zip",
];

#[derive(Debug, Default)]
struct TrieNode {
    children: HashMap<String, TrieNode>,
    param_child: Option<Box<TrieNode>>,
    promoted: bool,
}

#[derive(Debug)]
pub struct PathTrie {
    roots: Mutex<LruCache<String, TrieNode>>,
    threshold: usize,
}

impl PathTrie {
    #[must_use]
    pub fn new(threshold: usize) -> Self {
        let effective = if threshold == 0 { DEFAULT_PATH_TRIE_THRESHOLD } else { threshold };
        let cap = NonZeroUsize::new(DEFAULT_PATH_TRIE_MAX_HOSTS).unwrap_or(NonZeroUsize::MIN);
        PathTrie { roots: Mutex::new(LruCache::new(cap)), threshold: effective }
    }

    #[must_use]
    pub fn fingerprint(&self, host: &str, segments: &[String]) -> Vec<String> {
        let mut guard = self.roots.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let root = guard.get_or_insert_mut(host.to_string(), TrieNode::default);
        let mut out = Vec::with_capacity(segments.len());
        walk_trie(root, segments, self.threshold, &mut out);
        out
    }
}

fn walk_trie(node: &mut TrieNode, segments: &[String], threshold: usize, out: &mut Vec<String>) {
    let Some((seg, rest)) = segments.split_first() else { return };

    if node.promoted {
        out.push("{param}".to_string());
        let child = node.param_child.get_or_insert_with(|| Box::new(TrieNode::default()));
        walk_trie(child, rest, threshold, out);
        return;
    }

    if !node.children.contains_key(seg) {
        node.children.insert(seg.clone(), TrieNode::default());
        if node.children.len() > threshold {
            node.promoted = true;
            node.children.clear();
            let child = node.param_child.get_or_insert_with(|| Box::new(TrieNode::default()));
            out.push("{param}".to_string());
            walk_trie(child, rest, threshold, out);
            return;
        }
    }

    out.push(seg.clone());
    if let Some(child) = node.children.get_mut(seg) {
        walk_trie(child, rest, threshold, out);
    }
}

static UUID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        .expect("uuid")
});
static HEX64_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-fA-F]{64}$").expect("h64"));
static HEX40_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-fA-F]{40}$").expect("h40"));
static HEX32_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-fA-F]{32}$").expect("h32"));
static HEX24_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-fA-F]{24}$").expect("h24"));
static HEX8_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-fA-F]{8,}$").expect("h8"));
static DATE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}$").expect("date"));
static TS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{10}(\d{3})?$").expect("ts"));
static NUM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+$").expect("num"));

fn contains_hex_letter(s: &str) -> bool {
    s.chars().any(|c| matches!(c, 'a'..='f' | 'A'..='F'))
}

#[must_use]
pub fn normalize_segment(segment: &str) -> Option<&'static str> {
    if UUID_RE.is_match(segment) {
        return Some("{uuid}");
    }
    if HEX64_RE.is_match(segment) && contains_hex_letter(segment) {
        return Some("{sha256}");
    }
    if HEX40_RE.is_match(segment) && contains_hex_letter(segment) {
        return Some("{sha1}");
    }
    if HEX32_RE.is_match(segment) && contains_hex_letter(segment) {
        return Some("{md5}");
    }
    if HEX24_RE.is_match(segment) && contains_hex_letter(segment) {
        return Some("{oid}");
    }
    if HEX8_RE.is_match(segment) && contains_hex_letter(segment) {
        return Some("{hex}");
    }
    if DATE_RE.is_match(segment) {
        return Some("{date}");
    }
    if TS_RE.is_match(segment) {
        return Some("{ts}");
    }
    if NUM_RE.is_match(segment) {
        return Some("{num}");
    }
    None
}

#[must_use]
pub fn fingerprint_url(raw: &str, trie: Option<&PathTrie>) -> String {
    let Ok(url) = Url::parse(raw) else {
        return raw.to_string();
    };
    let path = url.path();
    let trimmed = path.trim_matches('/');
    let mut segments: Vec<String> = if trimmed.is_empty() {
        Vec::new()
    } else {
        trimmed.split('/').map(String::from).collect()
    };

    for seg in &mut segments {
        if let Some(placeholder) = normalize_segment(seg) {
            *seg = placeholder.to_string();
        }
    }

    if let Some(trie) = trie {
        let host = url.host_str().unwrap_or_default();
        segments = trie.fingerprint(host, &segments);
    }

    let mut normalized_path = String::from("/");
    normalized_path.push_str(&segments.join("/"));
    if path.ends_with('/') && !segments.is_empty() {
        normalized_path.push('/');
    }

    let mut out = String::new();
    out.push_str(url.scheme());
    out.push_str("://");
    if let Some(host) = url.host_str() {
        out.push_str(host);
    }
    if let Some(port) = url.port() {
        out.push(':');
        out.push_str(&port.to_string());
    }
    out.push_str(&normalized_path);

    let keys: BTreeSet<String> = url.query_pairs().map(|(k, _)| k.into_owned()).collect();
    if !keys.is_empty() {
        out.push('?');
        out.push_str(&keys.into_iter().collect::<Vec<_>>().join("&"));
    }
    out
}

#[derive(Debug, Clone)]
pub struct ExtensionValidator {
    match_set: HashSet<String>,
    filter_set: HashSet<String>,
}

impl ExtensionValidator {
    #[must_use]
    pub fn new(match_exts: &[String], filter_exts: &[String], no_default: bool) -> Self {
        let match_set = match_exts.iter().map(|e| normalize_ext(e)).collect();
        let mut filter_set = HashSet::new();
        if !no_default {
            filter_set.extend(DEFAULT_DENIED_EXTENSIONS.iter().map(|e| (*e).to_string()));
        }
        filter_set.extend(filter_exts.iter().map(|e| normalize_ext(e)));
        ExtensionValidator { match_set, filter_set }
    }

    #[must_use]
    pub fn validate(&self, url: &Url) -> bool {
        let ext = extension_of(url.path());
        if !self.match_set.is_empty() {
            return self.match_set.contains(&ext);
        }
        !self.filter_set.contains(&ext)
    }
}

fn normalize_ext(ext: &str) -> String {
    let e = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if e == "none" { String::new() } else { e }
}

fn extension_of(path: &str) -> String {
    let last = path.rsplit('/').next().unwrap_or("");
    match last.rsplit_once('.') {
        Some((name, ext)) if !name.is_empty() => ext.to_ascii_lowercase(),
        _ => String::new(),
    }
}

#[derive(Debug, Default)]
pub struct UniqueFilter {
    urls: DashSet<String>,
    contents: DashSet<[u8; 32]>,
    content_disabled: bool,
}

impl UniqueFilter {
    #[must_use]
    pub fn new(content_disabled: bool) -> Self {
        UniqueFilter { urls: DashSet::new(), contents: DashSet::new(), content_disabled }
    }

    pub fn unique_url(&self, key: &str) -> bool {
        self.urls.insert(key.to_string())
    }

    pub fn unique_content(&self, body: &[u8]) -> bool {
        if self.content_disabled {
            return true;
        }
        let hash = blake3::hash(body);
        self.contents.insert(*hash.as_bytes())
    }
}
