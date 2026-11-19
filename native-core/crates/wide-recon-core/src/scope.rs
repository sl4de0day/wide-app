use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use psl::Psl;
use regex::Regex;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cidr {
    network: IpAddr,
    prefix_len: u8,
}

impl Cidr {
    pub fn parse(s: &str) -> Result<Cidr, String> {
        let s = s.trim();
        let (addr_part, prefix_part) = s.split_once('/').map_or((s, None), |(a, p)| (a, Some(p)));
        let ip: IpAddr = addr_part.parse().map_err(|_| format!("invalid IP address: {addr_part:?}"))?;
        let max = match ip {
            IpAddr::V4(_) => 32u8,
            IpAddr::V6(_) => 128u8,
        };
        let prefix_len = if let Some(p) = prefix_part {
            let n: u8 = p.trim().parse().map_err(|_| format!("invalid prefix length: {p:?}"))?;
            if n > max {
                return Err(format!("prefix length {n} exceeds {max}"));
            }
            n
        } else {
            max
        };
        Ok(Cidr { network: mask_ip(ip, prefix_len), prefix_len })
    }

    #[must_use]
    pub fn parse_list(items: &[String]) -> Vec<Cidr> {
        items.iter().filter_map(|s| Cidr::parse(s).ok()).collect()
    }

    #[must_use]
    pub fn contains(&self, ip: IpAddr) -> bool {
        match (self.network, ip) {
            (IpAddr::V4(net), IpAddr::V4(addr)) => {
                let mask = mask_v4(self.prefix_len);
                (u32::from(addr) & mask) == (u32::from(net) & mask)
            }
            (IpAddr::V6(net), IpAddr::V6(addr)) => {
                let mask = mask_v6(self.prefix_len);
                (u128::from(addr) & mask) == (u128::from(net) & mask)
            }
            _ => false,
        }
    }
}

fn mask_v4(prefix: u8) -> u32 {
    u32::MAX.checked_shl(u32::from(32 - prefix)).unwrap_or(0)
}

fn mask_v6(prefix: u8) -> u128 {
    u128::MAX.checked_shl(u32::from(128 - prefix)).unwrap_or(0)
}

fn mask_ip(ip: IpAddr, prefix_len: u8) -> IpAddr {
    match ip {
        IpAddr::V4(v4) => IpAddr::V4(Ipv4Addr::from(u32::from(v4) & mask_v4(prefix_len))),
        IpAddr::V6(v6) => IpAddr::V6(Ipv6Addr::from(u128::from(v6) & mask_v6(prefix_len))),
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NetworkPolicy {
    pub allow_private: bool,
    pub allow_non_http: bool,
}

impl NetworkPolicy {
    #[must_use]
    pub fn permissive() -> Self {
        NetworkPolicy { allow_private: true, allow_non_http: true }
    }

    #[must_use]
    pub fn allows(&self, url: &Url) -> bool {
        if !self.allow_non_http && !matches!(url.scheme(), "http" | "https") {
            return false;
        }
        if !self.allow_private {
            if let Some(host) = url.host_str() {
                if is_internal_host(host) {
                    return false;
                }
            }
        }
        true
    }
}

#[must_use]
pub fn is_internal_host(host: &str) -> bool {
    let h = host.trim().to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") || h == "localhost.localdomain" {
        return true;
    }
    let literal = h.strip_prefix('[').and_then(|s| s.strip_suffix(']')).unwrap_or(&h);
    literal.parse::<IpAddr>().is_ok_and(|ip| is_internal_ip(&ip))
}

#[must_use]
pub fn is_internal_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_internal_v4(*v4),
        IpAddr::V6(v6) => is_internal_v6(v6),
    }
}

fn is_internal_v4(ip: Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_unspecified()
        || ip.is_documentation()
        || matches!(ip.octets(), [100, b, ..] if (64..=127).contains(&b))
}

fn is_internal_v6(ip: &Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    let seg0 = ip.segments()[0];
    (seg0 & 0xFE00) == 0xFC00 || (seg0 & 0xFFC0) == 0xFE80
}

#[derive(Debug, Clone)]
pub enum FieldScope {
    Dn,
    Rdn,
    Fqdn,
    Custom(Regex),
}

#[derive(Debug)]
pub struct ScopeManager {
    field: FieldScope,
    in_scope: Vec<Regex>,
    out_of_scope: Vec<Regex>,
    no_scope: bool,
    network: NetworkPolicy,
    exclude_cidrs: Vec<Cidr>,
}

impl ScopeManager {
    pub fn new(
        field_scope: &str,
        in_patterns: &[String],
        out_patterns: &[String],
        exclude: &[String],
        allow_private: bool,
        no_scope: bool,
    ) -> Result<Self, String> {
        let field = match field_scope.trim().to_ascii_lowercase().as_str() {
            "dn" => FieldScope::Dn,
            "rdn" | "" => FieldScope::Rdn,
            "fqdn" => FieldScope::Fqdn,
            other => FieldScope::Custom(Regex::new(other).map_err(|e| format!("invalid scope regex: {e}"))?),
        };
        let in_scope = in_patterns
            .iter()
            .map(|p| Regex::new(p).map_err(|e| format!("invalid in_scope regex {p:?}: {e}")))
            .collect::<Result<Vec<_>, _>>()?;
        let out_of_scope = out_patterns
            .iter()
            .map(|p| Regex::new(p).map_err(|e| format!("invalid out_of_scope regex {p:?}: {e}")))
            .collect::<Result<Vec<_>, _>>()?;
        let network = NetworkPolicy { allow_private, allow_non_http: false };
        let exclude_cidrs = Cidr::parse_list(exclude);
        Ok(ScopeManager { field, in_scope, out_of_scope, no_scope, network, exclude_cidrs })
    }

    #[must_use]
    pub fn validate(&self, url: &Url, root_hostname: &str) -> bool {
        if !self.network.allows(url) {
            return false;
        }
        if !self.exclude_cidrs.is_empty() {
            if let Some(ip) = url.host_str().and_then(|h| h.parse::<IpAddr>().ok()) {
                if self.exclude_cidrs.iter().any(|c| c.contains(ip)) {
                    return false;
                }
            }
        }
        if !self.no_scope {
            let host = url.host_str().unwrap_or_default();
            if !self.validate_dns(host, root_hostname) {
                return false;
            }
        }
        self.validate_url(url.as_str())
    }

    fn validate_url(&self, url: &str) -> bool {
        for re in &self.out_of_scope {
            if re.is_match(url) {
                return false;
            }
        }
        if self.in_scope.is_empty() {
            return true;
        }
        self.in_scope.iter().any(|re| re.is_match(url))
    }

    fn validate_dns(&self, host: &str, root_hostname: &str) -> bool {
        match &self.field {
            FieldScope::Custom(re) => re.is_match(host),
            FieldScope::Fqdn => host.eq_ignore_ascii_case(root_hostname),
            FieldScope::Dn => {
                let keyword = registrable_domain(root_hostname)
                    .and_then(|d| d.split('.').next().map(str::to_string))
                    .unwrap_or_else(|| root_hostname.to_string());
                host.to_ascii_lowercase().contains(&keyword.to_ascii_lowercase())
            }
            FieldScope::Rdn => {
                let root = registrable_domain(root_hostname).unwrap_or_else(|| root_hostname.to_string());
                let host_l = host.to_ascii_lowercase();
                let root_l = root.to_ascii_lowercase();
                host_l == root_l || host_l.ends_with(&format!(".{root_l}"))
            }
        }
    }
}

#[must_use]
pub fn registrable_domain(host: &str) -> Option<String> {
    let domain = psl::List.domain(host.as_bytes())?;
    std::str::from_utf8(domain.as_bytes()).ok().map(str::to_string)
}
