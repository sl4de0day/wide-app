use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::sync::{LazyLock, Mutex, PoisonError};

use fnv::FnvHasher;
use regex::Regex;
use scraper::{Html, Selector};

const MIN_TOKENS: usize = 5;
const SHINGLE_WIDTH: usize = 3;
const K1: f64 = 1.5;
const BM25_B: f64 = 0.75;
const MAX_TOKENS: u32 = 20_000;
const MIN_TOKEN_LEN: usize = 2;

static STRIP_TAGS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?is)<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>|<noscript\b[^>]*>.*?</noscript>|<svg\b[^>]*>.*?</svg>|<template\b[^>]*>.*?</template>|<nav\b[^>]*>.*?</nav>|<header\b[^>]*>.*?</header>|<footer\b[^>]*>.*?</footer>|<aside\b[^>]*>.*?</aside>",
    )
    .expect("strip tags regex")
});

#[derive(Debug, Clone)]
pub struct NormalizedDocument {
    pub shingles: Vec<String>,
}

#[must_use]
pub fn simhash64(features: &[String]) -> u64 {
    if features.is_empty() {
        return 0;
    }
    let mut counts: HashMap<&str, i64> = HashMap::new();
    for f in features {
        *counts.entry(f.as_str()).or_insert(0) += 1;
    }
    let mut weights = [0i64; 64];
    for (feature, weight) in counts {
        let h = hash64(feature);
        for (bit, w) in weights.iter_mut().enumerate() {
            if (h >> bit) & 1 == 1 {
                *w += weight;
            } else {
                *w -= weight;
            }
        }
    }
    let mut fp = 0u64;
    for (bit, w) in weights.iter().enumerate() {
        if *w > 0 {
            fp |= 1 << bit;
        }
    }
    fp
}

#[must_use]
pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

fn hash64(s: &str) -> u64 {
    let mut hasher = FnvHasher::default();
    s.hash(&mut hasher);
    hasher.finish()
}

#[must_use]
pub fn extract_visible_text(body: &[u8]) -> String {
    let raw = String::from_utf8_lossy(body);
    let head = raw.get(..512).unwrap_or(&raw).to_ascii_lowercase();
    let looks_html = head.contains("<html")
        || head.contains("<!doctype")
        || raw.contains("<body")
        || raw.contains("<div")
        || raw.contains("<p");
    if !looks_html {
        return raw.into_owned();
    }
    let cleaned = STRIP_TAGS_RE.replace_all(&raw, " ");
    let doc = Html::parse_document(&cleaned);
    for sel_str in ["main", "[role=main]", "article", "body"] {
        if let Ok(sel) = Selector::parse(sel_str) {
            if let Some(el) = doc.select(&sel).next() {
                let text: String = el.text().collect::<Vec<_>>().join(" ");
                if !text.trim().is_empty() {
                    return text;
                }
            }
        }
    }
    doc.root_element().text().collect::<Vec<_>>().join(" ")
}

#[must_use]
pub fn normalize_document(body: &[u8]) -> Option<NormalizedDocument> {
    let text = extract_visible_text(body);
    let tokens: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= MIN_TOKEN_LEN)
        .map(str::to_ascii_lowercase)
        .collect();
    if tokens.len() < MIN_TOKENS {
        return None;
    }
    let shingles = if tokens.len() < SHINGLE_WIDTH {
        tokens
    } else {
        (0..=tokens.len() - SHINGLE_WIDTH).map(|i| tokens[i..i + SHINGLE_WIDTH].join(" ")).collect()
    };
    Some(NormalizedDocument { shingles })
}

#[derive(Debug, Default)]
struct SimHashInner {
    sigs: Vec<(u64, u64)>,
    clusters: HashMap<u64, usize>,
    next_id: u64,
}

#[derive(Debug)]
pub struct SimHashIndex {
    max_distance: u32,
    budget: usize,
    max_docs: usize,
    inner: Mutex<SimHashInner>,
}

impl SimHashIndex {
    #[must_use]
    pub fn new(max_distance: u32, budget: usize) -> Self {
        SimHashIndex {
            max_distance: if max_distance == 0 { 3 } else { max_distance },
            budget: budget.max(1),
            max_docs: 1000,
            inner: Mutex::new(SimHashInner::default()),
        }
    }

    pub fn accept(&self, body: &[u8]) -> bool {
        let Some(doc) = normalize_document(body) else { return true };
        let fp = simhash64(&doc.shingles);
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let mut best: Option<(u64, u32)> = None;
        for &(id, existing) in &inner.sigs {
            let d = hamming_distance(fp, existing);
            if best.is_none_or(|(_, bd)| d < bd) {
                best = Some((id, d));
            }
        }
        if let Some((id, dist)) = best {
            if dist <= self.max_distance {
                let count = inner.clusters.entry(id).or_insert(0);
                if *count >= self.budget {
                    return false;
                }
                *count += 1;
                return true;
            }
        }
        while inner.sigs.len() >= self.max_docs {
            let (old_id, _) = inner.sigs.remove(0);
            inner.clusters.remove(&old_id);
        }
        let id = inner.next_id;
        inner.next_id += 1;
        inner.sigs.push((id, fp));
        inner.clusters.insert(id, 1);
        true
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LexicalMode {
    TfIdf,
    Bm25,
}

#[derive(Debug, Default, Clone)]
struct LexicalDoc {
    tf: HashMap<String, u32>,
    len: u32,
}

#[derive(Debug, Default)]
struct LexicalInner {
    corpus: VecDeque<LexicalDoc>,
    df: HashMap<String, u32>,
}

impl LexicalInner {
    fn insert(&mut self, doc: LexicalDoc, budget: usize) {
        for term in doc.tf.keys() {
            *self.df.entry(term.clone()).or_insert(0) += 1;
        }
        self.corpus.push_back(doc);
        while self.corpus.len() > budget {
            let Some(evicted) = self.corpus.pop_front() else { break };
            for term in evicted.tf.keys() {
                let drop_it = if let Some(c) = self.df.get_mut(term) {
                    *c -= 1;
                    *c == 0
                } else {
                    false
                };
                if drop_it {
                    self.df.remove(term);
                }
            }
        }
    }

    fn max_similarity(&self, mode: LexicalMode, query: &LexicalDoc) -> f64 {
        if self.corpus.is_empty() || query.tf.is_empty() {
            return 0.0;
        }
        match mode {
            LexicalMode::TfIdf => self.max_cosine(query),
            LexicalMode::Bm25 => self.max_bm25(query),
        }
    }

    fn max_cosine(&self, query: &LexicalDoc) -> f64 {
        let n = self.corpus.len() as f64;
        let idf = |term: &str| -> f64 {
            let df = f64::from(self.df.get(term).copied().unwrap_or(0));
            ((n + 1.0) / (df + 1.0)).ln() + 1.0
        };
        let qnorm = doc_norm(query, &idf);
        if qnorm <= 0.0 {
            return 0.0;
        }
        let mut best = 0.0_f64;
        for stored in &self.corpus {
            let snorm = doc_norm(stored, &idf);
            if snorm <= 0.0 {
                continue;
            }
            let (small, large) = if query.tf.len() <= stored.tf.len() { (query, stored) } else { (stored, query) };
            let mut dot = 0.0;
            for (term, &count) in &small.tf {
                if let Some(&other) = large.tf.get(term) {
                    let w = idf(term);
                    dot += (f64::from(count) * w) * (f64::from(other) * w);
                }
            }
            let cosine = dot / (qnorm * snorm);
            if cosine > best {
                best = cosine;
            }
        }
        best.clamp(0.0, 1.0)
    }

    fn max_bm25(&self, query: &LexicalDoc) -> f64 {
        let n = self.corpus.len() as f64;
        let total_len: f64 = self.corpus.iter().map(|d| f64::from(d.len)).sum();
        let avgdl = if total_len <= 0.0 { 1.0 } else { total_len / n };
        let idf = |term: &str| -> f64 {
            let df = f64::from(self.df.get(term).copied().unwrap_or(0));
            (((n - df + 0.5) / (df + 0.5)) + 1.0).ln()
        };
        let qlen = f64::from(query.len);
        let mut self_score = 0.0;
        for (term, &qf) in &query.tf {
            let freq = f64::from(qf);
            let denom = freq + K1 * (1.0 - BM25_B + BM25_B * qlen / avgdl);
            self_score += idf(term) * (freq * (K1 + 1.0)) / denom;
        }
        if self_score <= 0.0 {
            return 0.0;
        }
        let mut best = 0.0_f64;
        for stored in &self.corpus {
            let dlen = f64::from(stored.len);
            let mut score = 0.0;
            for term in query.tf.keys() {
                let Some(&df) = stored.tf.get(term) else { continue };
                let freq = f64::from(df);
                let denom = freq + K1 * (1.0 - BM25_B + BM25_B * dlen / avgdl);
                score += idf(term) * (freq * (K1 + 1.0)) / denom;
            }
            let ratio = score / self_score;
            if ratio > best {
                best = ratio;
            }
        }
        best.clamp(0.0, 1.0)
    }
}

fn doc_norm(doc: &LexicalDoc, idf: &impl Fn(&str) -> f64) -> f64 {
    doc.tf
        .iter()
        .map(|(t, &c)| {
            let v = f64::from(c) * idf(t);
            v * v
        })
        .sum::<f64>()
        .sqrt()
}

#[derive(Debug)]
pub struct LexicalIndex {
    mode: LexicalMode,
    threshold: f64,
    budget: usize,
    inner: Mutex<LexicalInner>,
}

impl LexicalIndex {
    #[must_use]
    pub fn new(mode: LexicalMode, threshold: f64, budget: usize) -> Self {
        LexicalIndex {
            mode,
            threshold: threshold.clamp(0.0, 1.0),
            budget: budget.max(1),
            inner: Mutex::new(LexicalInner::default()),
        }
    }

    pub fn accept(&self, body: &str) -> bool {
        let doc = tokenize_lexical(body);
        if doc.tf.is_empty() {
            return true;
        }
        let mut guard = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let sim = guard.max_similarity(self.mode, &doc);
        if sim >= self.threshold {
            return false;
        }
        guard.insert(doc, self.budget);
        true
    }
}

fn tokenize_lexical(body: &str) -> LexicalDoc {
    let text = extract_visible_text(body.as_bytes());
    let mut tf: HashMap<String, u32> = HashMap::new();
    let mut len = 0u32;
    for raw in text.split(|c: char| !c.is_alphanumeric()) {
        if raw.len() < MIN_TOKEN_LEN {
            continue;
        }
        *tf.entry(raw.to_ascii_lowercase()).or_insert(0) += 1;
        len += 1;
        if len >= MAX_TOKENS {
            break;
        }
    }
    LexicalDoc { tf, len }
}
