pub mod analyzers;
pub mod filters;
pub mod parser;
pub mod scope;
pub mod similarity;

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use url::Url;

    use crate::analyzers::{audit_security_headers, classify_endpoint, decode_jwt_tokens, detect_tech, scan_secrets};
    use crate::filters::{fingerprint_url, ExtensionValidator, PathTrie, UniqueFilter};
    use crate::parser::{extract_forms, extract_js_endpoints, extract_links, parse_robots_rules};
    use crate::scope::{Cidr, NetworkPolicy, ScopeManager};
    use crate::similarity::{hamming_distance, simhash64, LexicalIndex, LexicalMode, SimHashIndex};

    #[test]
    fn pathtrie_and_fingerprint_collapse_dynamic_segments() {
        let trie = PathTrie::new(3);
        for id in ["alpha", "beta", "gamma", "delta"] {
            let _ = fingerprint_url(&format!("https://example.com/items/{id}"), Some(&trie));
        }
        let fp = fingerprint_url("https://example.com/items/omega?b=2&a=1", Some(&trie));
        assert_eq!(fp, "https://example.com/items/{param}?a&b");
        assert_eq!(
            fingerprint_url("https://example.com/users/42", None),
            "https://example.com/users/{num}"
        );
    }

    #[test]
    fn simhash_and_bm25_filter_near_duplicates() {
        let s1 = vec!["hello world test".into(), "world test crawl".into()];
        let s2 = vec!["hello world test".into(), "world test crawl".into()];
        assert_eq!(hamming_distance(simhash64(&s1), simhash64(&s2)), 0);

        let body_a = "<main><p>Product catalog item alpha details pricing inventory status shipping warranty manual specifications reviews customer feedback portal warehouse stock dispatch tracking invoice checkout support terms privacy policy notice available online today for enterprise security teams</p></main>";
        let body_b = "<main><p>Product catalog item beta details pricing inventory status shipping warranty manual specifications reviews customer feedback portal warehouse stock dispatch tracking invoice checkout support terms privacy policy notice available online today for enterprise security teams</p></main>";
        let sim_idx = SimHashIndex::new(8, 1);
        assert!(sim_idx.accept(body_a.as_bytes()));
        assert!(!sim_idx.accept(body_b.as_bytes()));

        let lex = LexicalIndex::new(LexicalMode::Bm25, 0.85, 64);
        assert!(lex.accept(body_a));
        assert!(!lex.accept(body_b));
    }

    #[test]
    fn network_policy_and_scope_block_internal_ssrf() {
        let policy = NetworkPolicy::default();
        assert!(!policy.allows(&Url::parse("http://127.0.0.1/").unwrap()));
        assert!(!policy.allows(&Url::parse("http://169.254.169.254/latest/meta-data/").unwrap()));
        assert!(!policy.allows(&Url::parse("http://[::1]/").unwrap()));
        assert!(!policy.allows(&Url::parse("http://100.64.0.5/").unwrap()));
        assert!(policy.allows(&Url::parse("https://app.example.com/").unwrap()));

        let mgr = ScopeManager::new("rdn", &[], &[], &["10.0.0.0/8".into()], false, false).unwrap();
        assert!(mgr.validate(&Url::parse("https://api.example.com/v1").unwrap(), "www.example.com"));
        assert!(!mgr.validate(&Url::parse("https://evil.org/").unwrap(), "www.example.com"));

        let cidr = Cidr::parse("192.168.0.0/16").unwrap();
        assert!(cidr.contains("192.168.10.2".parse().unwrap()));
    }

    #[test]
    fn unique_and_extensions_filter_cleanly() {
        let u = UniqueFilter::new(false);
        assert!(u.unique_url("https://example.com/a"));
        assert!(!u.unique_url("https://example.com/a"));
        assert!(u.unique_content(b"abc"));
        assert!(!u.unique_content(b"abc"));

        let ext = ExtensionValidator::new(&[], &[], false);
        assert!(!ext.validate(&Url::parse("https://example.com/pic.png").unwrap()));
        assert!(ext.validate(&Url::parse("https://example.com/api/users").unwrap()));
    }

    #[test]
    fn parsers_and_passive_analyzers_work() {
        let base = Url::parse("https://app.example.com/assets/main.js").unwrap();
        let js_links = extract_js_endpoints(
            &base,
            r#"fetch("/api/v2/users"); axios.post("https://app.example.com/graphql");"#,
        );
        assert_eq!(js_links.len(), 2);

        let html_links = extract_links(
            &Url::parse("https://app.example.com/").unwrap(),
            r#"<a href="/login">Login</a><script src="/app.js"></script>"#,
        );
        assert_eq!(html_links.len(), 2);

        let forms = extract_forms(
            &Url::parse("https://app.example.com/").unwrap(),
            r#"<form action="/session" method="POST"><input name="user" type="text"></form>"#,
        );
        assert_eq!(forms.len(), 1);
        assert_eq!(forms[0].method, "post");

        let robots = parse_robots_rules("User-agent: *\nDisallow: /admin/\nAllow: /admin/ok\n", &["wide", "*"]);
        assert!(!robots.is_allowed("/admin/panel"));
        assert!(robots.is_allowed("/admin/ok"));

        let mut hdrs = BTreeMap::new();
        hdrs.insert("Server".into(), "nginx/1.25".into());
        hdrs.insert("Strict-Transport-Security".into(), "max-age=60".into());
        let sec = audit_security_headers(&hdrs);
        assert!(sec["issues"].as_array().is_some());
        assert_eq!(sec["disclosure"]["server"], "nginx/1.25");
        assert!(detect_tech(&hdrs, "<div data-reactroot></div>").contains(&"Nginx".to_string()));
        assert_eq!(
            classify_endpoint("POST", &Url::parse("https://x.io/api/v1/items").unwrap(), "application/json", "application/json"),
            Some("rest")
        );

        let low_entropy_secret = scan_secrets(r#"api_key = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa""#);
        assert!(low_entropy_secret.is_empty());
        let valid_secret = scan_secrets(r#"const k = "AIzaSyD-1234567890abcdefghijklmnopqrstu";"#);
        assert_eq!(valid_secret.len(), 1);

        let h = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        let p = "eyJzdWIiOiJ1c2VyLTEiLCJpc3MiOiJ3aWRlIn0";
        let tokens = decode_jwt_tokens(&format!("Authorization: Bearer {h}.{p}.c2lnbmF0dXJl"));
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0]["iss"], "wide");
    }
}
