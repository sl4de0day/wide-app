use std::cell::Cell;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use rand::Rng;

const BACKOFF_BASE_MS: u64 = 1_000;
const BACKOFF_MAX_MS: u64 = 30_000;

#[must_use]
pub fn is_throttled(status: u16) -> bool {
    status == 429 || status == 503
}

#[must_use]
pub fn parse_retry_after(headers: &BTreeMap<String, String>) -> Option<u64> {
    headers.get("retry-after")?.trim().parse::<u64>().ok()
}

#[derive(Debug, Default)]
pub struct HostBackoff {
    consecutive: DashMap<String, i32>,
    retry_until: DashMap<String, Instant>,
}

impl HostBackoff {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_throttle(&self, host: &str) {
        *self.consecutive.entry(host.to_string()).or_insert(0) += 1;
    }

    pub fn record_retry_after(&self, host: &str, delay: Duration) {
        let until = Instant::now() + delay;
        self.retry_until
            .entry(host.to_string())
            .and_modify(|t| {
                if until > *t {
                    *t = until;
                }
            })
            .or_insert(until);
    }

    pub fn record_success(&self, host: &str) {
        if let Some(mut n) = self.consecutive.get_mut(host) {
            if *n > 0 {
                *n -= 1;
            }
        }
    }

    #[must_use]
    pub fn delay_for(&self, host: &str) -> Duration {
        let n = self.consecutive.get(host).map_or(0, |v| *v);
        if n <= 0 {
            return Duration::ZERO;
        }
        let factor = 2u64.saturating_pow(u32::try_from(n).unwrap_or(0).saturating_sub(1));
        let exp_ms = BACKOFF_BASE_MS.saturating_mul(factor).min(BACKOFF_MAX_MS);
        let jitter_ms = rand::thread_rng().gen_range(0..=exp_ms / 2);
        Duration::from_millis(exp_ms + jitter_ms)
    }

    pub async fn apply(&self, host: &str) {
        let mut delay = self.delay_for(host);
        if let Some(until) = self.retry_until.get(host) {
            let remaining = until.saturating_duration_since(Instant::now());
            if remaining > delay {
                delay = remaining;
            }
        }
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

impl RetryPolicy {
    #[must_use]
    pub fn new(max_retries: u32) -> Self {
        RetryPolicy { max_retries, base_delay_ms: 200, max_delay_ms: 5_000 }
    }

    #[must_use]
    pub fn attempts(self) -> u32 {
        self.max_retries.saturating_add(1)
    }

    #[must_use]
    pub fn delay(self, attempt: u32) -> Duration {
        if attempt == 0 {
            return Duration::ZERO;
        }
        let shift = (attempt - 1).min(16);
        let exp = self.base_delay_ms.saturating_mul(1u64 << shift).min(self.max_delay_ms);
        let jitter_span = (exp / 4).max(1);
        Duration::from_millis(exp + xorshift_jitter(jitter_span))
    }
}

thread_local! {
    static JITTER_SEED: Cell<u64> = const { Cell::new(0x2545_F491_4F6C_DD1D) };
}

fn xorshift_jitter(span: u64) -> u64 {
    if span == 0 {
        return 0;
    }
    JITTER_SEED.with(|s| {
        let mut x = s.get();
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        s.set(x);
        x % span
    })
}
