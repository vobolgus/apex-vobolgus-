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
//! several times the bytes and some fifteen times the CPU.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};

/// Units for one chart drawn into a PDF, alone or in a document.
pub const PDF_CHART_COST: f64 = 4.0;
/// Units for one chart sent as SVG.
pub const SVG_CHART_COST: f64 = 1.0;

/// A client's burst: two full documents (200 charts each) back to back, or 1600
/// previews.
const CLIENT_BURST: f64 = 1600.0;
/// A client's steady rate, units per second: 900 PDF charts an hour.
const CLIENT_RATE: f64 = 1.0;
/// The server's burst: several clients at theirs.
const SERVER_BURST: f64 = 8000.0;
/// The server's steady rate, units per second: 1800 PDF charts an hour, roughly a
/// gigabyte of PDF, whoever asks and from however many addresses.
const SERVER_RATE: f64 = 2.0;
/// Clients remembered at once. Past this the idle ones are dropped, and if that is
/// not enough the newcomers share one bucket: the map cannot be grown without end.
const MAX_CLIENTS: usize = 4096;
/// The bucket of the clients that did not fit, and of a request with no address.
const SHARED_CLIENT: &str = "shared";

#[derive(Clone, Copy)]
struct Bucket {
    tokens: f64,
    updated: Instant,
}

impl Bucket {
    fn full(burst: f64, now: Instant) -> Self {
        Self {
            tokens: burst,
            updated: now,
        }
    }

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

struct Buckets {
    clients: HashMap<String, Bucket>,
    server: Bucket,
}

/// The export budget; one per server, in `AppState`.
pub struct ExportLimiter {
    buckets: Mutex<Buckets>,
}

impl Default for ExportLimiter {
    fn default() -> Self {
        Self::new(Instant::now())
    }
}

impl ExportLimiter {
    fn new(now: Instant) -> Self {
        Self {
            buckets: Mutex::new(Buckets {
                clients: HashMap::new(),
                server: Bucket::full(SERVER_BURST, now),
            }),
        }
    }

    /// Take `cost` units from `client`'s bucket and the server's, or neither.
    /// `Err` is how long to wait before the same request would pass.
    pub fn charge(&self, client: &str, cost: f64) -> Result<(), Duration> {
        self.charge_at(client, cost, Instant::now())
    }

    fn charge_at(&self, client: &str, cost: f64, now: Instant) -> Result<(), Duration> {
        // A request dearer than a full bucket would never pass: it waits for a full one.
        let cost = cost.min(CLIENT_BURST);
        let mut guard = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
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
            return Err(wait);
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
pub fn client_key(headers: &HeaderMap, peer: Option<SocketAddr>) -> String {
    let header = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    header("x-real-ip")
        .or_else(|| header("x-forwarded-for").and_then(|list| list.rsplit(',').next()))
        .map(str::trim)
        .filter(|address| !address.is_empty())
        .map(str::to_owned)
        .or_else(|| peer.map(|peer| peer.ip().to_string()))
        .unwrap_or_else(|| SHARED_CLIENT.to_owned())
}

/// The 429 for a request that must wait `wait`.
pub fn too_many_requests(wait: Duration) -> Response {
    let seconds = wait.as_secs_f64().ceil().max(1.0) as u64;
    let retry_after = HeaderValue::from_str(&seconds.to_string())
        .unwrap_or_else(|_| HeaderValue::from_static("60"));
    (
        StatusCode::TOO_MANY_REQUESTS,
        [(header::RETRY_AFTER, retry_after)],
        format!("too many exports; try again in {seconds} s"),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seconds(s: f64) -> Duration {
        Duration::from_secs_f64(s)
    }

    #[test]
    fn a_client_spends_its_burst_then_waits_for_the_rate() {
        let start = Instant::now();
        let limiter = ExportLimiter::new(start);
        // Two full documents pass at once.
        assert!(limiter.charge_at("a", 800.0, start).is_ok());
        assert!(limiter.charge_at("a", 800.0, start).is_ok());
        // The next chart waits for its four units at one a second.
        let wait = limiter.charge_at("a", PDF_CHART_COST, start).unwrap_err();
        assert_eq!(wait, seconds(4.0));
        assert!(
            limiter
                .charge_at("a", PDF_CHART_COST, start + seconds(3.9))
                .is_err()
        );
        assert!(
            limiter
                .charge_at("a", PDF_CHART_COST, start + seconds(4.0))
                .is_ok()
        );
    }

    #[test]
    fn a_refused_request_takes_nothing() {
        let start = Instant::now();
        let limiter = ExportLimiter::new(start);
        assert!(limiter.charge_at("a", 1599.0, start).is_ok());
        assert!(limiter.charge_at("a", 2.0, start).is_err());
        // The unit left is still there, for the client and for the server.
        assert!(limiter.charge_at("a", 1.0, start).is_ok());
    }

    #[test]
    fn one_client_does_not_spend_another_s_budget() {
        let start = Instant::now();
        let limiter = ExportLimiter::new(start);
        assert!(limiter.charge_at("a", 1600.0, start).is_ok());
        assert!(limiter.charge_at("a", 1.0, start).is_err());
        assert!(limiter.charge_at("b", 1600.0, start).is_ok());
    }

    #[test]
    fn the_server_s_ceiling_holds_however_many_clients_ask() {
        let start = Instant::now();
        let limiter = ExportLimiter::new(start);
        // Five clients, each within its own burst, empty the server's.
        for client in ["a", "b", "c", "d", "e"] {
            assert!(limiter.charge_at(client, 1600.0, start).is_ok());
        }
        let wait = limiter.charge_at("f", 100.0, start).unwrap_err();
        assert_eq!(wait, seconds(100.0 / SERVER_RATE));
        // A new address every time does not get round it either.
        assert!(limiter.charge_at("g", 1.0, start).is_err());
        assert!(limiter.charge_at("h", 2.0, start + seconds(1.0)).is_ok());
    }

    #[test]
    fn a_request_dearer_than_the_burst_passes_on_a_full_bucket() {
        let start = Instant::now();
        let limiter = ExportLimiter::new(start);
        assert!(limiter.charge_at("a", 1e9, start).is_ok());
        assert!(limiter.charge_at("a", 1.0, start).is_err());
    }

    #[test]
    fn the_client_map_stays_bounded() {
        let start = Instant::now();
        let limiter = ExportLimiter::new(start);
        for i in 0..MAX_CLIENTS + 100 {
            let _ = limiter.charge_at(&format!("client-{i}"), 1.0, start);
        }
        let clients = limiter.buckets.lock().unwrap().clients.len();
        // The newcomers past the cap share one bucket.
        assert!(clients <= MAX_CLIENTS + 1, "{clients}");

        // Once the old ones have refilled they are forgotten, and there is room again.
        let later = start + seconds(CLIENT_BURST / CLIENT_RATE);
        let _ = limiter.charge_at("newcomer", 1.0, later);
        let buckets = limiter.buckets.lock().unwrap();
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
    fn the_429_says_when_to_come_back() {
        let response = too_many_requests(seconds(12.3));
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()[header::RETRY_AFTER], "13");
    }
}
