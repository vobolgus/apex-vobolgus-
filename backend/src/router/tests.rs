use std::path::PathBuf;
use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::cached;

fn test_app() -> Router {
    let state = AppState::new(Arc::new(rust_core::catalog::HipCatalog::new()));
    router(state, None)
}

#[tokio::test]
async fn smoke_health_endpoint() {
    let app = test_app();
    let response = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn smoke_catalog_layered_loading_contract() {
    let app = test_app();

    let bright_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/catalog/bright")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bright_response.status(), StatusCode::OK);
    let bright_body = to_bytes(bright_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let bright_stars: Vec<Value> = serde_json::from_slice(&bright_body).unwrap();
    assert!(!bright_stars.is_empty());
    assert!(bright_stars.iter().all(|s| {
        s.get("v_mag")
            .and_then(Value::as_f64)
            .is_some_and(|v| v <= 4.0)
    }));

    let full_response = app
        .oneshot(
            Request::builder()
                .uri("/api/catalog/full")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(full_response.status(), StatusCode::OK);
    let full_body = to_bytes(full_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let full_stars: Vec<Value> = serde_json::from_slice(&full_body).unwrap();
    assert!(full_stars.len() > bright_stars.len());

    // A star is its position and brightness, nothing a client can work out itself.
    for star in bright_stars.iter().chain(&full_stars) {
        let mut fields: Vec<&str> = star
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        fields.sort_unstable();
        assert_eq!(fields, ["dec", "ra", "v_mag"]);
    }
}

/// GET `uri` with `headers`; the response's status, headers and raw body.
async fn get(
    app: &Router,
    uri: &str,
    headers: &[(header::HeaderName, &str)],
) -> (StatusCode, header::HeaderMap, Vec<u8>) {
    let mut request = Request::builder().uri(uri);
    for (name, value) in headers {
        request = request.header(name, *value);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let body = to_bytes(body, usize::MAX).await.unwrap().to_vec();
    (parts.status, parts.headers, body)
}

#[tokio::test]
async fn catalog_endpoints_are_cacheable_and_compressed() {
    use std::io::Read;

    let app = test_app();
    for uri in [
        "/api/catalog/bright",
        "/api/catalog/full",
        "/api/catalog/full?max_mag=6.5",
        "/api/constellations",
        "/api/constellation-boundaries",
        "/api/catalog/messier",
    ] {
        let (status, headers, plain) = get(&app, uri, &[]).await;
        assert_eq!(status, StatusCode::OK, "{uri}");
        assert_eq!(
            headers[header::CACHE_CONTROL],
            cached::CATALOG_CACHE_CONTROL,
            "{uri}"
        );
        assert_eq!(headers[header::CONTENT_TYPE], "application/json", "{uri}");
        assert!(!headers.contains_key(header::CONTENT_ENCODING), "{uri}");
        let etag = headers[header::ETAG].to_str().unwrap().to_owned();

        // The gzip body is the same JSON, and a good deal smaller.
        let (status, headers, packed) =
            get(&app, uri, &[(header::ACCEPT_ENCODING, "gzip, br")]).await;
        assert_eq!(status, StatusCode::OK, "{uri}");
        assert_eq!(headers[header::CONTENT_ENCODING], "gzip", "{uri}");
        assert_eq!(headers[header::ETAG], etag.as_str(), "{uri}");
        assert!(packed.len() * 2 < plain.len(), "{uri}");
        let mut unpacked = Vec::new();
        flate2::read::GzDecoder::new(packed.as_slice())
            .read_to_end(&mut unpacked)
            .unwrap();
        assert_eq!(unpacked, plain, "{uri}");

        // A client that holds the body is told so, and sent nothing.
        let (status, headers, body) = get(&app, uri, &[(header::IF_NONE_MATCH, &etag)]).await;
        assert_eq!(status, StatusCode::NOT_MODIFIED, "{uri}");
        assert_eq!(headers[header::ETAG], etag.as_str(), "{uri}");
        assert!(body.is_empty(), "{uri}");
    }
}

#[tokio::test]
async fn a_custom_catalog_slice_is_computed_and_not_cached() {
    let app = test_app();
    let (status, headers, body) = get(&app, "/api/catalog/full?max_mag=2.0", &[]).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!headers.contains_key(header::CACHE_CONTROL));
    let stars: Vec<Value> = serde_json::from_slice(&body).unwrap();
    assert!(!stars.is_empty());
    assert!(
        stars
            .iter()
            .all(|star| star["v_mag"].as_f64().unwrap() <= 2.0)
    );
}

/// A static build in a temp directory of its own: a page, a hashed asset with
/// its packed twin, and the 404 page.
fn static_build(name: &str) -> PathBuf {
    use std::io::Write;

    let dir = std::env::temp_dir().join(format!("apex-static-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("_app/immutable")).unwrap();
    std::fs::write(dir.join("index.html"), "<h1>chart</h1>").unwrap();
    std::fs::write(dir.join("404.html"), "<h1>lost</h1>").unwrap();
    let script = "console.log('app');".repeat(20);
    std::fs::write(dir.join("_app/immutable/app.abc123.js"), &script).unwrap();
    let mut packed = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    packed.write_all(script.as_bytes()).unwrap();
    std::fs::write(
        dir.join("_app/immutable/app.abc123.js.gz"),
        packed.finish().unwrap(),
    )
    .unwrap();
    dir
}

#[tokio::test]
async fn the_static_build_is_served_with_the_api_beside_it() {
    let dir = static_build("served");
    let state = AppState::new(Arc::new(rust_core::catalog::HipCatalog::new()));
    let app = router(state, Some(&dir));

    // The page is revalidated on every visit, so a deploy shows at once.
    let (status, headers, body) = get(&app, "/", &[]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"<h1>chart</h1>");
    assert_eq!(headers[header::CACHE_CONTROL], "no-cache");
    assert!(
        headers[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/html")
    );

    // A hashed asset is kept for a year, and goes out packed as the build left it.
    let (status, headers, plain) = get(&app, "/_app/immutable/app.abc123.js", &[]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers[header::CACHE_CONTROL],
        "public, max-age=31536000, immutable"
    );
    let (status, headers, packed) = get(
        &app,
        "/_app/immutable/app.abc123.js",
        &[(header::ACCEPT_ENCODING, "gzip")],
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_ENCODING], "gzip");
    assert!(packed.len() < plain.len());

    // No file: the 404 page with a 404, and not cached for a year even under /_app.
    for uri in ["/nowhere", "/_app/immutable/gone.js"] {
        let (status, headers, _) = get(&app, uri, &[]).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
        assert_ne!(
            headers
                .get(header::CACHE_CONTROL)
                .map(axum::http::HeaderValue::as_bytes),
            Some("public, max-age=31536000, immutable".as_bytes()),
            "{uri}"
        );
    }
    let (_, _, lost) = get(&app, "/nowhere", &[]).await;
    assert_eq!(lost, b"<h1>lost</h1>");

    // The API keeps its routes, and the old generator URL still lands on the page.
    let (status, _, body) = get(&app, "/api/health", &[]).await;
    assert_eq!(
        (status, body.as_slice()),
        (StatusCode::OK, b"ok".as_slice())
    );
    let (status, _, _) = get(&app, "/api/catalog/bright", &[]).await;
    assert_eq!(status, StatusCode::OK);
    let (status, headers, _) = get(&app, "/generator", &[]).await;
    assert_eq!(status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(headers[header::LOCATION], "/");

    std::fs::remove_dir_all(&dir).unwrap();
}

/// A chart as the page sends it: the preview's camera, no observer.
fn view_chart() -> Value {
    json!({
        "projection": "stereo",
        "datetime": "2026-05-20T12:00:00Z",
        "magnitude_limit": 6.5,
        "fov_deg": 180.0,
        "view": {
            "right": [0.0, 1.0, 0.0], "up": [0.0, 0.0, 1.0], "forward": [1.0, 0.0, 0.0],
            "width": 1104.0, "height": 1104.0
        },
        "layers": {
            "ecliptic": true, "equator": true, "galactic_equator": false, "planets": false,
            "horizontal_grid": false, "equatorial_grid": false, "constellations": true,
            "constellation_boundaries": true, "constellation_names": false,
            "zenith": false, "poles": false
        },
        "style": {
            "star_color": "#000000", "constellation_line_color": "#808080",
            "grid_color": "#404040", "background_color": "#0a0a0b",
            "chart_color": "#ffffff", "font_family": "sans-serif", "magnitude_scale": 1.0
        },
        "print_info": false
    })
}

/// POST `body` as JSON to `uri` with `headers`.
async fn post(
    app: &Router,
    uri: &str,
    headers: &[(header::HeaderName, &str)],
    body: &Value,
) -> (StatusCode, header::HeaderMap, Vec<u8>) {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    for (name, value) in headers {
        request = request.header(name, *value);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    let body = to_bytes(body, usize::MAX).await.unwrap().to_vec();
    (parts.status, parts.headers, body)
}

#[tokio::test]
async fn an_svg_export_is_gzipped_for_a_client_that_takes_gzip() {
    use std::io::Read;

    let app = test_app();
    let uri = "/api/export?format=svg";
    let (status, headers, plain) = post(&app, uri, &[], &view_chart()).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!headers.contains_key(header::CONTENT_ENCODING));
    assert_eq!(headers[header::VARY], "accept-encoding");
    assert!(plain.starts_with(b"<svg"));

    let gzip = [(header::ACCEPT_ENCODING, "gzip, deflate, br")];
    let (status, headers, packed) = post(&app, uri, &gzip, &view_chart()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_ENCODING], "gzip");
    assert!(packed.len() * 3 < plain.len());
    let mut unpacked = Vec::new();
    flate2::read::GzDecoder::new(packed.as_slice())
        .read_to_end(&mut unpacked)
        .unwrap();
    assert_eq!(unpacked, plain);

    // A PDF is packed inside already: it goes out as it is.
    let (status, headers, pdf) = post(&app, "/api/export", &gzip, &view_chart()).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!headers.contains_key(header::CONTENT_ENCODING));
    assert!(pdf.starts_with(b"%PDF"));
}

#[tokio::test]
async fn exports_past_the_budget_are_refused_until_it_refills() {
    let app = test_app();
    let client = [(header::HeaderName::from_static("x-real-ip"), "203.0.113.9")];
    // 400 charts at four units each: the whole of a client's burst, taken before
    // anything is looked at (the document itself is then refused as too large).
    let chart = json!({ "x_mm": 10.0, "y_mm": 10.0, "width_mm": 50.0, "height_mm": 50.0,
        "config": view_chart() });
    let page = json!({ "width_mm": 210.0, "height_mm": 297.0, "items": vec![chart; 50] });
    let document = json!({ "pages": vec![page; 8] });
    let (status, _, _) = post(&app, "/api/export/document", &client, &document).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let svg = "/api/export?format=svg";
    let (status, headers, body) = post(&app, svg, &client, &view_chart()).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(headers[header::RETRY_AFTER], "1");
    assert!(
        String::from_utf8(body)
            .unwrap()
            .contains("too many exports")
    );

    // Another visitor is not held back by this one.
    let other = [(header::HeaderName::from_static("x-real-ip"), "198.51.100.4")];
    let (status, _, _) = post(&app, svg, &other, &view_chart()).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn smoke_export_validation_errors() {
    let app = test_app();
    let base_payload = json!({
        "projection": "stereo",
        "datetime": "2026-05-20T12:00:00Z",
        "latitude": 55.75,
        "longitude": 37.62,
        "magnitude_limit": 6.0,
        "fov_deg": 120.0,
        "aspect_ratio": 1.0,
        "constellation": null,
        "tilt_angle": 0.0,
        "layers": {
            "ecliptic": true,
            "equator": false,
            "galactic_equator": false,
            "planets": false,
            "horizontal_grid": false,
            "equatorial_grid": false,
            "constellations": true,
            "constellation_names": false,
            "zenith": false,
            "poles": false
        },
        "style": {
            "star_color": "#FFFFFF",
            "constellation_line_color": "#808080",
            "grid_color": "#404040",
            "background_color": "#05050A",
            "font_family": "sans-serif",
            "magnitude_scale": 1.0
        },
        "print_info": false,
        "footer_text": null
    });

    let mut invalid_projection = base_payload.clone();
    invalid_projection["projection"] = json!("cylindric");
    let projection_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/export")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(invalid_projection.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(projection_response.status(), StatusCode::BAD_REQUEST);

    let mut invalid_latitude = base_payload.clone();
    invalid_latitude["latitude"] = json!(123.0);
    let latitude_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/export")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(invalid_latitude.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(latitude_response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn smoke_export_document_route() {
    let app = test_app();
    let post = |body: Value| {
        Request::builder()
            .method("POST")
            .uri("/api/export/document")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    };

    let empty = app
        .clone()
        .oneshot(post(json!({ "pages": [] })))
        .await
        .unwrap();
    assert_eq!(empty.status(), StatusCode::BAD_REQUEST);
    let message = to_bytes(empty.into_body(), usize::MAX).await.unwrap();
    assert!(String::from_utf8_lossy(&message).contains("1 to 100 pages"));

    let blank = app
        .oneshot(post(json!({
            "pages": [{ "width_mm": 210, "height_mm": 297, "items": [] }]
        })))
        .await
        .unwrap();
    assert_eq!(blank.status(), StatusCode::OK);
    assert_eq!(blank.headers()[header::CONTENT_TYPE], "application/pdf");
    assert_eq!(
        blank.headers()[header::CONTENT_DISPOSITION],
        "attachment; filename=\"skycharts.pdf\""
    );
    let pdf = to_bytes(blank.into_body(), usize::MAX).await.unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}
