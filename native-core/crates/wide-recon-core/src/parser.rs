use std::collections::BTreeSet;
use std::sync::LazyLock;

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use regex::Regex;
use scraper::{Html, Selector};
use serde::Serialize;
use url::Url;

const HTML_TARGETS: &[(&str, &str, &str)] = &[
    ("a[href]", "href", "a"),
    ("link[href]", "href", "link"),
    ("script[src]", "src", "script"),
    ("img[src]", "src", "img"),
    ("iframe[src]", "src", "iframe"),
    ("frame[src]", "src", "frame"),
    ("embed[src]", "src", "embed"),
    ("source[src]", "src", "source"),
    ("audio[src]", "src", "audio"),
    ("video[src]", "src", "video"),
    ("object[data]", "data", "object"),
    ("area[href]", "href", "area"),
    ("form[action]", "action", "form"),
    ("base[href]", "href", "base"),
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiscoveredLink {
    pub url: String,
    pub source: String,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FormField {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FormInfo {
    pub action: String,
    pub method: String,
    pub fields: Vec<FormField>,
}

static JS_CALL_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    let r = |p: &str| Regex::new(p).expect("js pattern");
    vec![
        r(r#"fetch\s*\(\s*["'`]([^"'`]+)["'`]"#),
        r(r#"\.(?:get|post|put|delete|patch|head|options)\s*\(\s*["'`]([^"'`]+)["'`]"#),
        r(r#"\.open\s*\(\s*["'`][A-Za-z]+["'`]\s*,\s*["'`]([^"'`]+)["'`]"#),
        r(r#"(?:url|uri|endpoint|baseURL|baseUrl|path|action|href)\s*:\s*["'`]([^"'`]+)["'`]"#),
    ]
});

static JS_STRING_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"["'`]((?:https?:)?//[^\s"'`<>]+|/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{2,})["'`]"#)
        .expect("js url string")
});

fn resolve_http_url(base: &Url, raw: &str) -> Option<Url> {
    let raw = raw.trim();
    if raw.len() < 2 || raw.starts_with('#') || raw.contains(char::is_whitespace) {
        return None;
    }
    let lower = raw.to_ascii_lowercase();
    for bad in ["javascript:", "mailto:", "data:", "vbscript:", "tel:", "about:", "${"] {
        if lower.starts_with(bad) {
            return None;
        }
    }
    let cleaned = raw.split_once("${").map_or(raw, |(head, _)| head);
    if cleaned.is_empty() {
        return None;
    }
    let mut url = base.join(cleaned).ok()?;
    url.set_fragment(None);
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    Some(url)
}

#[must_use]
pub fn extract_links(base: &Url, body: &str) -> Vec<DiscoveredLink> {
    let doc = Html::parse_document(body);
    let mut effective_base = base.clone();
    if let Ok(sel) = Selector::parse("base[href]") {
        if let Some(el) = doc.select(&sel).next() {
            if let Some(href) = el.value().attr("href") {
                if let Ok(joined) = effective_base.join(href) {
                    effective_base = joined;
                }
            }
        }
    }

    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for (selector, attr, tag) in HTML_TARGETS {
        let Ok(sel) = Selector::parse(selector) else { continue };
        let source = if *tag == "form" { "form" } else { "link" };
        for el in doc.select(&sel) {
            if let Some(raw) = el.value().attr(attr) {
                if let Some(url) = resolve_http_url(&effective_base, raw) {
                    let s = url.to_string();
                    if seen.insert(s.clone()) {
                        out.push(DiscoveredLink {
                            url: s,
                            source: source.to_string(),
                            tag: (*tag).to_string(),
                        });
                    }
                }
            }
        }
    }
    out
}

#[must_use]
pub fn script_texts(body: &str) -> Vec<String> {
    let doc = Html::parse_document(body);
    let mut out = Vec::new();
    if let Ok(sel) = Selector::parse("script:not([src])") {
        for el in doc.select(&sel) {
            let text: String = el.text().collect();
            if !text.trim().is_empty() {
                out.push(text);
            }
        }
    }
    out
}

#[must_use]
pub fn extract_js_endpoints(base: &Url, text: &str) -> Vec<DiscoveredLink> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for re in JS_CALL_PATTERNS.iter() {
        for caps in re.captures_iter(text) {
            let Some(m) = caps.get(1) else { continue };
            let raw = m.as_str().trim();
            if !(raw.starts_with("http://") || raw.starts_with("https://") || raw.starts_with('/') || raw.contains('/')) {
                continue;
            }
            if let Some(url) = resolve_http_url(base, raw) {
                let s = url.to_string();
                if seen.insert(s.clone()) {
                    out.push(DiscoveredLink {
                        url: s,
                        source: "js".to_string(),
                        tag: "callsite".to_string(),
                    });
                }
            }
        }
    }
    for caps in JS_STRING_URL_RE.captures_iter(text) {
        let Some(m) = caps.get(1) else { continue };
        if let Some(url) = resolve_http_url(base, m.as_str()) {
            let s = url.to_string();
            if seen.insert(s.clone()) {
                out.push(DiscoveredLink {
                    url: s,
                    source: "js".to_string(),
                    tag: "literal".to_string(),
                });
            }
        }
    }
    out
}

#[must_use]
pub fn extract_forms(base: &Url, body: &str) -> Vec<FormInfo> {
    let doc = Html::parse_document(body);
    let (Ok(form_sel), Ok(field_sel)) = (Selector::parse("form"), Selector::parse("input, select, textarea")) else {
        return Vec::new();
    };
    let mut forms = Vec::new();
    for form in doc.select(&form_sel) {
        let action_attr = form.value().attr("action").unwrap_or("").trim();
        let action = if action_attr.is_empty() {
            base.to_string()
        } else {
            base.join(action_attr).map_or_else(|_| base.to_string(), |u| u.to_string())
        };
        let method = form.value().attr("method").unwrap_or("get").to_ascii_lowercase();
        let mut fields = Vec::new();
        for field in form.select(&field_sel) {
            let el = field.value();
            let Some(name) = el.attr("name").or_else(|| el.attr("id")) else { continue };
            if name.is_empty() {
                continue;
            }
            let kind = el.attr("type").unwrap_or_else(|| el.name()).to_ascii_lowercase();
            fields.push(FormField { name: name.to_string(), kind });
        }
        forms.push(FormInfo { action, method, fields });
    }
    forms
}

#[derive(Debug, Clone)]
struct RobotsRule {
    allow: bool,
    pattern: String,
}

#[derive(Debug, Clone, Default)]
pub struct RobotsRules {
    rules: Vec<RobotsRule>,
}

impl RobotsRules {
    #[must_use]
    pub fn allow_all() -> Self {
        RobotsRules { rules: Vec::new() }
    }

    #[must_use]
    pub fn is_allowed(&self, path: &str) -> bool {
        let mut best: Option<(usize, bool)> = None;
        for rule in &self.rules {
            if let Some(len) = robots_pattern_len(&rule.pattern, path) {
                let better = match best {
                    Some((blen, ballow)) => len > blen || (len == blen && rule.allow && !ballow),
                    None => true,
                };
                if better {
                    best = Some((len, rule.allow));
                }
            }
        }
        best.is_none_or(|(_, allow)| allow)
    }
}

fn robots_pattern_len(pattern: &str, path: &str) -> Option<usize> {
    if pattern.is_empty() {
        return None;
    }
    let anchored = pattern.ends_with('$');
    let pat = pattern.trim_end_matches('$');
    let mut pos = 0usize;
    for (i, part) in pat.split('*').enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            if !path[pos..].starts_with(part) {
                return None;
            }
            pos += part.len();
        } else {
            pos += path[pos..].find(part)? + part.len();
        }
    }
    if anchored && pos != path.len() {
        return None;
    }
    Some(pat.chars().filter(|&c| c != '*').count())
}

#[must_use]
pub fn parse_robots_rules(text: &str, user_agents: &[&str]) -> RobotsRules {
    let mut groups: Vec<(Vec<String>, Vec<RobotsRule>)> = Vec::new();
    let mut cur_agents: Vec<String> = Vec::new();
    let mut cur_rules: Vec<RobotsRule> = Vec::new();
    let mut last_was_agent = false;

    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        let Some((field, value)) = line.split_once(':') else { continue };
        let field = field.trim().to_ascii_lowercase();
        let value = value.trim().to_string();
        match field.as_str() {
            "user-agent" => {
                if !last_was_agent && !cur_agents.is_empty() {
                    groups.push((std::mem::take(&mut cur_agents), std::mem::take(&mut cur_rules)));
                }
                cur_agents.push(value.to_ascii_lowercase());
                last_was_agent = true;
            }
            "allow" | "disallow" => {
                last_was_agent = false;
                cur_rules.push(RobotsRule { allow: field == "allow", pattern: value });
            }
            _ => {}
        }
    }
    if !cur_agents.is_empty() {
        groups.push((cur_agents, cur_rules));
    }
    let wants: Vec<String> = user_agents.iter().map(|a| a.to_ascii_lowercase()).collect();
    for agent in wants.iter().chain(std::iter::once(&"*".to_string())) {
        let mut rules = Vec::new();
        let mut matched = false;
        for (agents, grp) in &groups {
            if agents.iter().any(|a| a == agent) {
                matched = true;
                rules.extend(grp.iter().cloned());
            }
        }
        if matched {
            rules.retain(|r| !r.pattern.is_empty());
            return RobotsRules { rules };
        }
    }
    RobotsRules::allow_all()
}

#[must_use]
pub fn parse_robots_entries(base: &Url, text: &str) -> Vec<DiscoveredLink> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        let Some((directive, value)) = line.split_once(':') else { continue };
        let d = directive.trim().to_ascii_lowercase();
        if d == "allow" || d == "disallow" || d == "sitemap" {
            if let Some(url) = resolve_http_url(base, value) {
                out.push(DiscoveredLink {
                    url: url.to_string(),
                    source: "robots".to_string(),
                    tag: d,
                });
            }
        }
    }
    out
}

#[must_use]
pub fn parse_sitemap_entries(base: &Url, xml: &str) -> Vec<DiscoveredLink> {
    let mut reader = Reader::from_str(xml);
    let mut out = Vec::new();
    let mut in_loc = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == b"loc" => in_loc = true,
            Ok(Event::End(e)) if e.name().as_ref() == b"loc" => in_loc = false,
            Ok(Event::Text(t)) if in_loc => {
                if let Ok(raw) = t.unescape() {
                    if let Some(url) = resolve_http_url(base, &raw) {
                        out.push(DiscoveredLink {
                            url: url.to_string(),
                            source: "sitemap".to_string(),
                            tag: "loc".to_string(),
                        });
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

#[must_use]
pub fn parse_response_links(base: &Url, headers: &std::collections::BTreeMap<String, String>, body: &str, js_crawl: bool) -> Vec<DiscoveredLink> {
    let mut out = extract_links(base, body);
    let ct = headers.get("content-type").map_or("", String::as_str).to_ascii_lowercase();
    if js_crawl {
        if ct.contains("javascript") || ct.contains("ecmascript") || base.path().ends_with(".js") || base.path().ends_with(".mjs") {
            out.extend(extract_js_endpoints(base, body));
        } else {
            for script in script_texts(body) {
                out.extend(extract_js_endpoints(base, &script));
            }
        }
    }
    out
}
