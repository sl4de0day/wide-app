use std::collections::BTreeMap;
use std::str::FromStr;
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use reqwest::Method;
use url::Url;

use crate::backoff::RetryPolicy;
use crate::tls::{default_headers, install_impersonation, user_agent, ImpersonateProfile};

pub const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, Clone)]
pub struct HttpClientConfig {
    pub timeout_secs: u64,
    pub retries: u32,
    pub max_redirects: usize,
    pub disable_redirects: bool,
    pub body_read_size: usize,
    pub tls_profile: ImpersonateProfile,
    pub custom_headers: Vec<(String, String)>,
}

impl Default for HttpClientConfig {
    fn default() -> Self {
        HttpClientConfig {
            timeout_secs: 15,
            retries: 1,
            max_redirects: 8,
            disable_redirects: false,
            body_read_size: 2 * 1024 * 1024,
            tls_profile: ImpersonateProfile::None,
            custom_headers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub final_url: Url,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    pub content_length: usize,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone)]
pub struct HttpClient {
    inner: reqwest::Client,
    body_read_size: usize,
    retries: u32,
}

impl HttpClient {
    pub fn new(cfg: &HttpClientConfig) -> Result<Self, String> {
        install_impersonation(cfg.tls_profile);
        let mut hdrs = HeaderMap::new();
        for (k, v) in default_headers(cfg.tls_profile) {
            if let (Ok(name), Ok(val)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                hdrs.insert(name, val);
            }
        }
        for (k, v) in &cfg.custom_headers {
            if let (Ok(name), Ok(val)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                hdrs.insert(name, val);
            }
        }
        let ua = user_agent(cfg.tls_profile).unwrap_or(DEFAULT_USER_AGENT);
        let redirect = if cfg.disable_redirects {
            Policy::none()
        } else {
            Policy::limited(cfg.max_redirects)
        };
        let client = reqwest::Client::builder()
            .user_agent(ua)
            .timeout(Duration::from_secs(cfg.timeout_secs.max(1)))
            .redirect(redirect)
            .cookie_store(true)
            .gzip(true)
            .brotli(true)
            .deflate(true)
            .default_headers(hdrs)
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| format!("failed to build http client: {e}"))?;

        Ok(HttpClient {
            inner: client,
            body_read_size: cfg.body_read_size.max(4096),
            retries: cfg.retries,
        })
    }

    pub async fn request(
        &self,
        method: &str,
        url: &Url,
        headers: &[(String, String)],
        body: Option<&str>,
    ) -> Result<HttpResponse, String> {
        let parsed_method = Method::from_str(&method.to_ascii_uppercase())
            .map_err(|e| format!("invalid method {method}: {e}"))?;
        let policy = RetryPolicy::new(self.retries);
        let mut last_err = String::from("request failed");
        let started = Instant::now();

        for attempt in 0..policy.attempts() {
            let delay = policy.delay(attempt);
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }
            let mut req = self.inner.request(parsed_method.clone(), url.clone());
            for (k, v) in headers {
                if let (Ok(name), Ok(val)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
                    req = req.header(name, val);
                }
            }
            if let Some(b) = body {
                if !b.is_empty() {
                    req = req.body(b.to_string());
                }
            }
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let final_url = resp.url().clone();
                    let mut out_headers = BTreeMap::new();
                    for (name, val) in resp.headers() {
                        if let Ok(s) = val.to_str() {
                            out_headers.insert(name.as_str().to_ascii_lowercase(), s.to_string());
                        }
                    }
                    let bytes = resp.bytes().await.map_err(|e| format!("body read failed: {e}"))?;
                    let slice = if bytes.len() > self.body_read_size {
                        &bytes[..self.body_read_size]
                    } else {
                        &bytes[..]
                    };
                    return Ok(HttpResponse {
                        status,
                        final_url,
                        headers: out_headers,
                        body: String::from_utf8_lossy(slice).into_owned(),
                        content_length: bytes.len(),
                        elapsed_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
                    });
                }
                Err(e) => last_err = e.to_string(),
            }
        }
        Err(last_err)
    }

    pub async fn get(&self, url: &Url) -> Result<HttpResponse, String> {
        self.request("GET", url, &[], None).await
    }
}
