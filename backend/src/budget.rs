//! What keeps the export endpoints from running up the bill.
//!
//! An export is the only expensive thing the server does: CPU to draw it, memory
//! while it is drawn and, most of all, the megabytes sent back. Anyone can ask for
//! one, so the asking is rationed in *charts*, with a token bucket per client and
//! one for the whole server:
//!
//! - the per-client bucket stops one visitor's loop from being served forever;
//! - the server's bucket is the ceiling that holds whoever is asking. The client is
//!   told apart by the address the host's proxy reports, which a host may get
//!   wrong or a caller may forge, so the ceiling must not depend on it.
//!
//! A request past either gets a 429 with `Retry-After`. A chart in a PDF costs
//! `PDF_CHART_COST` units and an SVG (the page editor's previews) one: the PDF is
//! several times the bytes and some fifteen times the CPU. The numbers are in
//! `crate::limits`.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use axum::http::HeaderMap;
use thiserror::Error;

use crate::limits::{CLIENT_BURST, CLIENT_RATE, MAX_CLIENTS, SERVER_BURST, SERVER_RATE};

/// The bucket of the clients that did not fit, and of a request with no address.
const SHARED_CLIENT: &str = "shared";

/// A token bucket: what is left to spend, and when that was last worked out.
#[derive(Clone, Copy)]
struct Bucket {
    /// Units left to spend.
    tokens: f64,
    /// When `tokens` was last brought up to date.
    updated: Instant,
}

impl Bucket {
    /// A bucket holding its whole burst.
    fn full(burst: f64, now: Instant) -> Self {
        Self {
            tokens: burst,
            updated: now,
        }
    }

    /// Adds what `rate` units a second have brought since the last look, up to `burst`.
    fn refill(&mut self, burst: f64, rate: f64, now: Instant) {
        let elapsed = now.saturating_duration_since(self.updated).as_secs_f64();
        self.tokens = (self.tokens + elapsed * rate).min(burst);
        self.updated = now;
    }

    /// How long until `cost` units are there; zero when they are.
    fn wait_for(&self, cost: f64, rate: f64) -> Duration {
        if self.tokens >= cost {
            Duration::ZERO
        } else {
            Duration::from_secs_f64((cost - self.tokens) / rate)
        }
    }
}

/// Every bucket there is: one per client, by its key, and the server's.
struct Buckets {
    /// A bucket a client, by `client_key`.
    clients: HashMap<String, Bucket>,
    /// The ceiling over them all.
    server: Bucket,
}

/// A request the budget cannot pay for yet: the 429.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("too many exports; try again in {} s", self.retry_after_secs())]
pub(crate) struct OverBudget {
    /// How long until the same request would pass.
    pub(crate) wait: Duration,
}

impl OverBudget {
    /// The wait in whole seconds, rounded up and never zero: what `Retry-After` says.
    pub(crate) fn retry_after_secs(&self) -> u64 {
        self.wait.as_secs_f64().ceil().max(1.0) as u64
    }
}

/// The export budget; one per server, in `AppState`.
pub(crate) struct ExportBudget {
    /// Behind one lock: a charge takes from a client's bucket and the server's together.
    buckets: Mutex<Buckets>,
}

impl Default for ExportBudget {
    fn default() -> Self {
        Self::new(Instant::now())
    }
}

impl ExportBudget {
    /// A full budget as of `now`.
    fn new(now: Instant) -> Self {
        Self {
            buckets: Mutex::new(Buckets {
                clients: HashMap::new(),
                server: Bucket::full(SERVER_BURST, now),
            }),
        }
    }

    /// Take `cost` units from `client`'s bucket and the server's, or neither.
    /// The error says how long to wait before the same request would pass.
    pub(crate) fn charge(&self, client: &str, cost: f64) -> Result<(), OverBudget> {
        self.charge_at(client, cost, Instant::now())
    }

    /// `charge` at the instant `now`, which the tests choose for themselves.
    fn charge_at(&self, client: &str, cost: f64, now: Instant) -> Result<(), OverBudget> {
        // A request dearer than a full bucket would never pass: it waits for a full one.
        let cost = cost.min(CLIENT_BURST);
        // The buckets are plain numbers, sound whatever a panicking holder was doing.
        let mut guard = self.buckets.lock().unwrap_or_else(PoisonError::into_inner);
        let buckets = &mut *guard;

        if !buckets.clients.contains_key(client) && buckets.clients.len() >= MAX_CLIENTS {
            // A bucket that has refilled says nothing a new one would not.
            buckets.clients.retain(|_, bucket| {
                bucket.refill(CLIENT_BURST, CLIENT_RATE, now);
                bucket.tokens < CLIENT_BURST
            });
        }
        let key = if buckets.clients.contains_key(client) || buckets.clients.len() < MAX_CLIENTS {
            client
        } else {
            SHARED_CLIENT
        };

        buckets.server.refill(SERVER_BURST, SERVER_RATE, now);
        let server_wait = buckets.server.wait_for(cost, SERVER_RATE);
        let bucket = buckets
            .clients
            .entry(key.to_owned())
            .or_insert_with(|| Bucket::full(CLIENT_BURST, now));
        bucket.refill(CLIENT_BURST, CLIENT_RATE, now);
        let wait = server_wait.max(bucket.wait_for(cost, CLIENT_RATE));
        if !wait.is_zero() {
            return Err(OverBudget { wait });
        }
        bucket.tokens -= cost;
        buckets.server.tokens -= cost;
        Ok(())
    }
}

/// Who is asking, for the per-client bucket: the address the host's proxy reports
/// (`X-Real-IP`, as Railway's edge sets it; else the last hop of `X-Forwarded-For`,
/// the one a proxy appends), else the socket's. Best effort by design: see the
/// module docs for why the server's bucket does not rely on it.
pub(crate) fn client_key(headers: &HeaderMap, peer: Option<SocketAddr>) -> String {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    header("x-real-ip")
        .or_else(|| header("x-forwarded-for").and_then(|list| list.rsplit(',').next()))
        .map(str::trim)
        .filter(|address| !address.is_empty())
        .map(str::to_owned)
        .or_else(|| peer.map(|peer| peer.ip().to_string()))
        .unwrap_or_else(|| SHARED_CLIENT.to_owned())
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderValue, header};

    use super::*;
    use crate::limits::PDF_CHART_COST;

    fn seconds(s: f64) -> Duration {
        Duration::from_secs_f64(s)
    }

    #[test]
    fn a_client_spends_its_burst_then_waits_for_the_rate() {
        let start = Instant::now();
        let budget = ExportBudget::new(start);
        // Two full documents pass at once.
        assert!(budget.charge_at("a", 800.0, start).is_ok());
        assert!(budget.charge_at("a", 800.0, start).is_ok());
        // The next chart waits for its four units at one a second.
        let refused = budget.charge_at("a", PDF_CHART_COST, start).unwrap_err();
        assert_eq!(refused.wait, seconds(4.0));
        assert!(
            budget
                .charge_at("a", PDF_CHART_COST, start + seconds(3.9))
                .is_err()
        );
        assert!(
            budget
                .charge_at("a", PDF_CHART_COST, start + seconds(4.0))
                .is_ok()
        );
    }

    #[test]
    fn a_refused_request_takes_nothing() {
        let start = Instant::now();
        let budget = ExportBudget::new(start);
        assert!(budget.charge_at("a", 1599.0, start).is_ok());
        assert!(budget.charge_at("a", 2.0, start).is_err());
        // The unit left is still there, for the client and for the server.
        assert!(budget.charge_at("a", 1.0, start).is_ok());
    }

    #[test]
    fn one_client_does_not_spend_another_s_budget() {
        let start = Instant::now();
        let budget = ExportBudget::new(start);
        assert!(budget.charge_at("a", 1600.0, start).is_ok());
        assert!(budget.charge_at("a", 1.0, start).is_err());
        assert!(budget.charge_at("b", 1600.0, start).is_ok());
    }

    #[test]
    fn the_server_s_ceiling_holds_however_many_clients_ask() {
        let start = Instant::now();
        let budget = ExportBudget::new(start);
        // Five clients, each within its own burst, empty the server's.
        for client in ["a", "b", "c", "d", "e"] {
            assert!(budget.charge_at(client, 1600.0, start).is_ok());
        }
        let refused = budget.charge_at("f", 100.0, start).unwrap_err();
        assert_eq!(refused.wait, seconds(100.0 / SERVER_RATE));
        // A new address every time does not get round it either.
        assert!(budget.charge_at("g", 1.0, start).is_err());
        assert!(budget.charge_at("h", 2.0, start + seconds(1.0)).is_ok());
    }

    #[test]
    fn a_request_dearer_than_the_burst_passes_on_a_full_bucket() {
        let start = Instant::now();
        let budget = ExportBudget::new(start);
        assert!(budget.charge_at("a", 1e9, start).is_ok());
        assert!(budget.charge_at("a", 1.0, start).is_err());
    }

    #[test]
    fn the_client_map_stays_bounded() {
        let start = Instant::now();
        let budget = ExportBudget::new(start);
        for i in 0..MAX_CLIENTS + 100 {
            let _ = budget.charge_at(&format!("client-{i}"), 1.0, start);
        }
        let clients = budget.buckets.lock().unwrap().clients.len();
        // The newcomers past the cap share one bucket.
        assert!(clients <= MAX_CLIENTS + 1, "{clients}");

        // Once the old ones have refilled they are forgotten, and there is room again.
        let later = start + seconds(CLIENT_BURST / CLIENT_RATE);
        let _ = budget.charge_at("newcomer", 1.0, later);
        let buckets = budget.buckets.lock().unwrap();
        assert!(buckets.clients.contains_key("newcomer"));
        assert!(buckets.clients.len() < 10);
    }

    #[test]
    fn the_client_is_the_address_the_proxy_reports() {
        let peer: SocketAddr = "10.0.0.7:4000".parse().unwrap();
        let headers = |pairs: &[(&'static str, &'static str)]| {
            pairs
                .iter()
                .map(|(name, value)| {
                    (
                        header::HeaderName::from_static(name),
                        HeaderValue::from_static(value),
                    )
                })
                .collect::<HeaderMap>()
        };
        let real = headers(&[("x-real-ip", "203.0.113.9"), ("x-forwarded-for", "1.1.1.1")]);
        assert_eq!(client_key(&real, Some(peer)), "203.0.113.9");
        // Only the last hop of the list was written by a proxy; the rest is the caller's word.
        let forwarded = headers(&[("x-forwarded-for", "6.6.6.6, 198.51.100.4")]);
        assert_eq!(client_key(&forwarded, Some(peer)), "198.51.100.4");
        assert_eq!(client_key(&HeaderMap::new(), Some(peer)), "10.0.0.7");
        assert_eq!(client_key(&HeaderMap::new(), None), SHARED_CLIENT);
    }

    #[test]
    fn the_wait_is_told_in_whole_seconds_and_never_none() {
        let refused = |s: f64| OverBudget { wait: seconds(s) };
        assert_eq!(refused(12.3).retry_after_secs(), 13);
        assert_eq!(refused(0.001).retry_after_secs(), 1);
        assert_eq!(
            refused(12.3).to_string(),
            "too many exports; try again in 13 s"
        );
    }
}
