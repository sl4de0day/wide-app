pub mod backoff;
pub mod client;
pub mod tls;

#[cfg(test)]
mod tests {
    use crate::backoff::{is_throttled, RetryPolicy};
    use crate::tls::{default_headers, user_agent, ImpersonateProfile};

    #[test]
    fn tls_profiles_and_retry_work() {
        let chrome = ImpersonateProfile::parse("chrome");
        assert!(chrome.is_active());
        assert!(user_agent(chrome).unwrap().contains("Chrome"));
        assert!(!default_headers(chrome).is_empty());

        let policy = RetryPolicy::new(2);
        assert_eq!(policy.attempts(), 3);
        assert_eq!(policy.delay(0).as_millis(), 0);
        assert!(is_throttled(429));
        assert!(is_throttled(503));
        assert!(!is_throttled(200));
    }
}
