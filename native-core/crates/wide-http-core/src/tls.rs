use rustls::crypto::{ring, SupportedKxGroup};
use rustls::{CipherSuite, NamedGroup, SupportedCipherSuite};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ImpersonateProfile {
    #[default]
    None,
    Chrome,
    Firefox,
    Safari,
}

impl ImpersonateProfile {
    #[must_use]
    pub fn parse(name: &str) -> Self {
        match name.trim().to_ascii_lowercase().as_str() {
            "chrome" | "chromium" => ImpersonateProfile::Chrome,
            "firefox" | "ff" => ImpersonateProfile::Firefox,
            "safari" => ImpersonateProfile::Safari,
            _ => ImpersonateProfile::None,
        }
    }

    #[must_use]
    pub fn is_active(self) -> bool {
        self != ImpersonateProfile::None
    }
}

fn cipher_preference(profile: ImpersonateProfile) -> &'static [CipherSuite] {
    match profile {
        ImpersonateProfile::Chrome | ImpersonateProfile::None => &[
            CipherSuite::TLS13_AES_128_GCM_SHA256,
            CipherSuite::TLS13_CHACHA20_POLY1305_SHA256,
            CipherSuite::TLS13_AES_256_GCM_SHA384,
            CipherSuite::TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
            CipherSuite::TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
            CipherSuite::TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
            CipherSuite::TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
            CipherSuite::TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
            CipherSuite::TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
        ],
        ImpersonateProfile::Firefox => &[
            CipherSuite::TLS13_AES_128_GCM_SHA256,
            CipherSuite::TLS13_CHACHA20_POLY1305_SHA256,
            CipherSuite::TLS13_AES_256_GCM_SHA384,
            CipherSuite::TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
            CipherSuite::TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
            CipherSuite::TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
            CipherSuite::TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
            CipherSuite::TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256,
            CipherSuite::TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
        ],
        ImpersonateProfile::Safari => &[
            CipherSuite::TLS13_AES_256_GCM_SHA384,
            CipherSuite::TLS13_AES_128_GCM_SHA256,
            CipherSuite::TLS13_CHACHA20_POLY1305_SHA256,
            CipherSuite::TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
            CipherSuite::TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
            CipherSuite::TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
            CipherSuite::TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
        ],
    }
}

fn reorder_suites(pref: &[CipherSuite], suites: &[SupportedCipherSuite]) -> Vec<SupportedCipherSuite> {
    let mut ordered = Vec::with_capacity(suites.len());
    for want in pref {
        if let Some(found) = suites.iter().find(|s| s.suite() == *want) {
            if !ordered.iter().any(|s: &SupportedCipherSuite| s.suite() == found.suite()) {
                ordered.push(*found);
            }
        }
    }
    for s in suites {
        if !ordered.iter().any(|o| o.suite() == s.suite()) {
            ordered.push(*s);
        }
    }
    ordered
}

fn reorder_kx(pref: &[NamedGroup], groups: &[&'static dyn SupportedKxGroup]) -> Vec<&'static dyn SupportedKxGroup> {
    let mut ordered = Vec::with_capacity(groups.len());
    for want in pref {
        if let Some(found) = groups.iter().find(|g| g.name() == *want) {
            if !ordered.iter().any(|g: &&'static dyn SupportedKxGroup| g.name() == found.name()) {
                ordered.push(*found);
            }
        }
    }
    for g in groups {
        if !ordered.iter().any(|o| o.name() == g.name()) {
            ordered.push(*g);
        }
    }
    ordered
}

pub fn install_impersonation(profile: ImpersonateProfile) {
    if !profile.is_active() {
        return;
    }
    let mut provider = ring::default_provider();
    provider.cipher_suites = reorder_suites(cipher_preference(profile), &provider.cipher_suites);
    provider.kx_groups = reorder_kx(&[NamedGroup::X25519, NamedGroup::secp256r1, NamedGroup::secp384r1], &provider.kx_groups);
    let _ = provider.install_default();
}

#[must_use]
pub fn user_agent(profile: ImpersonateProfile) -> Option<&'static str> {
    match profile {
        ImpersonateProfile::None => None,
        ImpersonateProfile::Chrome => Some(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        ),
        ImpersonateProfile::Firefox => Some(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
        ),
        ImpersonateProfile::Safari => Some(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
        ),
    }
}

#[must_use]
pub fn default_headers(profile: ImpersonateProfile) -> &'static [(&'static str, &'static str)] {
    match profile {
        ImpersonateProfile::Chrome => &[
            ("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
            ("accept-language", "en-US,en;q=0.9"),
            ("sec-fetch-dest", "document"),
            ("sec-fetch-mode", "navigate"),
            ("sec-fetch-site", "none"),
            ("sec-fetch-user", "?1"),
            ("upgrade-insecure-requests", "1"),
        ],
        ImpersonateProfile::Firefox | ImpersonateProfile::Safari => &[
            ("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
            ("accept-language", "en-US,en;q=0.9"),
            ("upgrade-insecure-requests", "1"),
        ],
        ImpersonateProfile::None => &[],
    }
}
