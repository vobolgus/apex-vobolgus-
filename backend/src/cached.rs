//! Responses that do not change while the server runs, kept ready to send.
//!
//! The catalog endpoints answer every visitor with the same bytes. Building them
//! per request (filter, serialize, compress) is the server's whole load, so each
//! is built once: the JSON, its gzip at the best level and an ETag. A request then
//! costs a header check and a reference-counted clone, and with `Cache-Control` a
//! browser or a CDN in front asks again only once a day (and gets a 304 then).

use axum::body::Bytes;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use flate2::{Compression, write::GzEncoder};
use rust_core::catalog::HipCatalog;
use serde::Serialize;
use std::io::Write;
use std::sync::OnceLock;

use crate::payload::{self, BRIGHT_MAX_MAG, FULL_MAX_MAG};

/// Fresh for a day, and for a week after that the stale copy is shown while a new
/// one is fetched behind it: the catalogs only change with a deploy.
pub(crate) const CATALOG_CACHE_CONTROL: &str =
    "public, max-age=86400, stale-while-revalidate=604800";

/// A JSON body serialized and compressed once.
pub(crate) struct CachedJson {
    /// The JSON as it is.
    body: Bytes,
    /// The same JSON, gzipped.
    gzip: Bytes,
    /// What names this body to a client that may already hold it.
    etag: HeaderValue,
}

impl CachedJson {
    /// `value` as JSON, with its gzip and its tag.
    pub(crate) fn new<T: Serialize + ?Sized>(value: &T) -> Self {
        let body = serde_json::to_vec(value).expect("catalog data serializes to JSON");
        let mut encoder = GzEncoder::new(Vec::with_capacity(body.len() / 3), Compression::best());
        encoder
            .write_all(&body)
            .expect("writing to a Vec cannot fail");
        let gzip = encoder.finish().expect("writing to a Vec cannot fail");
        // Weak: the identity and gzip bodies share it, being the same JSON.
        let etag = HeaderValue::from_str(&format!("W/\"{:016x}\"", fnv1a(&body)))
            .expect("a hex ETag is a valid header value");
        Self {
            body: body.into(),
            gzip: gzip.into(),
            etag,
        }
    }

    /// The response for a request with these headers: a 304 when the client
    /// already holds this body, else the body, gzipped when the client takes gzip.
    pub(crate) fn response(&self, request: &HeaderMap) -> Response {
        let caching = [
            (header::ETAG, self.etag.clone()),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static(CATALOG_CACHE_CONTROL),
            ),
            (header::VARY, HeaderValue::from_static("accept-encoding")),
        ];
        if self.matches(request) {
            return (StatusCode::NOT_MODIFIED, caching).into_response();
        }
        let json = (
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        if accepts_gzip(request) {
            let gzip = (header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
            (caching, [json, gzip], self.gzip.clone()).into_response()
        } else {
            (caching, [json], self.body.clone()).into_response()
        }
    }

    /// `If-None-Match` names this body (weak comparison, or `*`).
    fn matches(&self, request: &HeaderMap) -> bool {
        let ours = opaque_tag(self.etag.to_str().unwrap_or_default());
        request
            .get_all(header::IF_NONE_MATCH)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .flat_map(|value| value.split(','))
            .map(str::trim)
            .any(|tag| tag == "*" || opaque_tag(tag) == ours)
    }
}

/// An ETag without its weakness mark.
fn opaque_tag(tag: &str) -> &str {
    tag.strip_prefix("W/").unwrap_or(tag)
}

/// `Accept-Encoding` lists gzip and does not refuse it with `q=0`.
pub(crate) fn accepts_gzip(request: &HeaderMap) -> bool {
    request
        .get_all(header::ACCEPT_ENCODING)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .any(|item| {
            let mut parts = item.split(';');
            let coding = parts.next().unwrap_or_default().trim();
            let refused = parts.any(|param| {
                param
                    .trim()
                    .strip_prefix("q=")
                    .and_then(|q| q.trim().parse::<f32>().ok())
                    .is_some_and(|q| q == 0.0)
            });
            coding.eq_ignore_ascii_case("gzip") && !refused
        })
}

/// FNV-1a, 64 bit: the same tag for the same bytes on every run and every build.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// The catalog endpoints' default answers, each built on first use (`warm` builds
/// them all at startup, so no visitor waits for it).
#[derive(Default)]
pub(crate) struct CatalogCache {
    /// `/api/catalog/bright`.
    bright: OnceLock<CachedJson>,
    /// `/api/catalog/full`.
    full: OnceLock<CachedJson>,
    /// `/api/constellations`.
    constellations: OnceLock<CachedJson>,
    /// `/api/constellation-boundaries`.
    constellation_boundaries: OnceLock<CachedJson>,
    /// `/api/catalog/messier`.
    messier: OnceLock<CachedJson>,
}

impl CatalogCache {
    /// The stars of `/api/catalog/bright`, to its default limit.
    pub(crate) fn bright(&self, catalog: &HipCatalog) -> &CachedJson {
        self.bright
            .get_or_init(|| CachedJson::new(&payload::stars(catalog, BRIGHT_MAX_MAG, None)))
    }

    /// The stars of `/api/catalog/full`, to its default limit.
    pub(crate) fn full(&self, catalog: &HipCatalog) -> &CachedJson {
        self.full
            .get_or_init(|| CachedJson::new(&payload::stars(catalog, FULL_MAX_MAG, None)))
    }

    /// The stick figures of `/api/constellations`.
    pub(crate) fn constellations(&self, catalog: &HipCatalog) -> &CachedJson {
        self.constellations
            .get_or_init(|| CachedJson::new(&payload::constellation_figures(catalog)))
    }

    /// The boundaries of `/api/constellation-boundaries`.
    pub(crate) fn constellation_boundaries(&self) -> &CachedJson {
        self.constellation_boundaries
            .get_or_init(|| CachedJson::new(&payload::constellation_boundaries()))
    }

    /// The objects of `/api/catalog/messier`.
    pub(crate) fn messier(&self) -> &CachedJson {
        self.messier
            .get_or_init(|| CachedJson::new(&payload::messier()))
    }

    /// Builds every answer now.
    pub(crate) fn warm(&self, catalog: &HipCatalog) {
        self.bright(catalog);
        self.full(catalog);
        self.constellations(catalog);
        self.constellation_boundaries();
        self.messier();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(header::HeaderName, &str)]) -> HeaderMap {
        pairs
            .iter()
            .map(|(name, value)| (name.clone(), HeaderValue::from_str(value).unwrap()))
            .collect()
    }

    #[test]
    fn gzip_is_taken_only_when_offered() {
        let accept = |value| accepts_gzip(&headers(&[(header::ACCEPT_ENCODING, value)]));
        assert!(accept("gzip"));
        assert!(accept("br, GZIP;q=0.8, deflate"));
        assert!(!accept("br, deflate"));
        assert!(!accept("gzip;q=0, br"));
        assert!(!accept("gzip; q=0.0"));
        assert!(!accepts_gzip(&HeaderMap::new()));
    }

    #[test]
    fn if_none_match_compares_weakly() {
        let cached = CachedJson::new(&[1, 2, 3]);
        let tag = cached.etag.to_str().unwrap().to_owned();
        let strong = tag.trim_start_matches("W/").to_owned();
        let matches = |value: &str| cached.matches(&headers(&[(header::IF_NONE_MATCH, value)]));
        assert!(matches(&tag));
        assert!(matches(&strong));
        assert!(matches(&format!("\"other\", {tag}")));
        assert!(matches("*"));
        assert!(!matches("\"other\""));
        assert!(!cached.matches(&HeaderMap::new()));
    }

    #[test]
    fn the_tag_follows_the_body() {
        let tag = |value: &[i32]| CachedJson::new(value).etag;
        assert_eq!(tag(&[1, 2, 3]), tag(&[1, 2, 3]));
        assert_ne!(tag(&[1, 2, 3]), tag(&[1, 2, 4]));
    }
}
