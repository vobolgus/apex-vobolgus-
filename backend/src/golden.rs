//! Pins what the server sends, byte for byte.
//!
//! The crate behind these tests may be taken apart and put together again; what a
//! client gets must not move. So every test here asks the way a client does, with
//! JSON, through the router, and holds the answer to a recorded value: the status,
//! the headers and the message of every refusal, and a digest of every chart.
//!
//! Three things keep a digest from being a plain hash of the bytes:
//!
//! - The constellations are kept in hash maps, so their figures, their boundaries
//!   and their names come out in a different order on every run. Each such run of
//!   elements is sorted before it is hashed (`canonical`); everything else is held
//!   to its place.
//! - The trigonometry is the platform's libm, and two of those differ in the last
//!   bit now and then. The `exact` digest and the byte count are therefore held
//!   only where they were recorded (`RECORDED_HERE`); the `shape` digest, the same
//!   text with every number struck out, is held everywhere.
//! - A digest says that something moved, not what. With `GOLDEN_DUMP=<dir>` set,
//!   every case writes its canonical text there, to be diffed against a dump taken
//!   before the change.

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Request, StatusCode, header};
use serde_json::{Value, json};
use tower::ServiceExt;

/// The only lines that know the crate's own names; all else goes through them.
mod subject {
    use std::sync::{Arc, OnceLock};

    use axum::Router;
    use rust_core::catalog::HipCatalog;
    use serde_json::Value;

    use crate::document::Document;
    use crate::request::DocumentRequest;

    fn catalog() -> Arc<HipCatalog> {
        static HIP: OnceLock<Arc<HipCatalog>> = OnceLock::new();
        HIP.get_or_init(|| Arc::new(HipCatalog::new())).clone()
    }

    /// The server without a static build: a fresh export budget and catalogue cache.
    pub fn app() -> Router {
        crate::router(crate::AppState::new(catalog()), None)
    }

    /// The SVG of every page of a document request, as the PDF is made from them.
    pub fn page_svgs(document: &Value) -> Vec<String> {
        let request: DocumentRequest =
            serde_json::from_value(document.clone()).expect("the fixture is a document request");
        let document = Document::try_from(request).expect("the fixture is valid");
        document
            .pages()
            .iter()
            .enumerate()
            .map(|(index, page)| page.to_svg(index, &catalog()))
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Asking, and reading the answer.
// ---------------------------------------------------------------------------

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Reply {
    fn text(&self) -> &str {
        std::str::from_utf8(&self.body).expect("the body is text")
    }

    fn header(&self, name: header::HeaderName) -> Option<&str> {
        self.headers
            .get(name)
            .map(|value| value.to_str().expect("the header is text"))
    }

    /// Every `Vary` the answer carries: the handler's own, then the CORS layer's.
    fn vary(&self) -> Vec<&str> {
        self.headers
            .get_all(header::VARY)
            .iter()
            .map(|value| value.to_str().expect("the header is text"))
            .collect()
    }
}

async fn send(app: &Router, request: Request<Body>) -> Reply {
    let response = app.clone().oneshot(request).await.unwrap();
    let (parts, body) = response.into_parts();
    Reply {
        status: parts.status,
        headers: parts.headers,
        body: to_bytes(body, usize::MAX).await.unwrap().to_vec(),
    }
}

async fn get(app: &Router, uri: &str) -> Reply {
    send(app, Request::get(uri).body(Body::empty()).unwrap()).await
}

async fn post(app: &Router, uri: &str, body: &Value) -> Reply {
    let request = Request::post(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    send(app, request).await
}

const TEXT: Option<&str> = Some("text/plain; charset=utf-8");

/// What the CORS layer adds to every answer's `Vary`.
const CORS_VARY: &str = "origin, access-control-request-method, access-control-request-headers";

// ---------------------------------------------------------------------------
// Digests.
// ---------------------------------------------------------------------------

/// Where the `exact` digests were recorded: see the module docs.
const RECORDED_HERE: bool = cfg!(all(target_os = "macos", target_arch = "aarch64"));

/// FNV-1a, 64 bit.
fn digest(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// `text` with every number struck out: what is left is the same on every platform.
fn shape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        let starts_number =
            c.is_ascii_digit() || (c == '-' && chars.peek().is_some_and(char::is_ascii_digit));
        if !starts_number {
            out.push(c);
            continue;
        }
        while chars
            .peek()
            .is_some_and(|c| c.is_ascii_digit() || *c == '.')
        {
            chars.next();
        }
        out.push('#');
    }
    out
}

/// The elements of an SVG in order: a tag that opens something, a tag that closes
/// it, or a whole leaf (`<circle ... />`, `<text ...>...</text>`).
fn elements(svg: &str) -> Vec<&str> {
    let mut elements = Vec::new();
    let mut rest = svg;
    while !rest.is_empty() {
        assert!(rest.starts_with('<'), "text outside an element: {rest:.80}");
        let end = if rest.starts_with("<text") {
            rest.find("</text>").expect("a text is closed") + "</text>".len()
        } else {
            rest.find('>').expect("a tag is closed") + 1
        };
        elements.push(&rest[..end]);
        rest = &rest[end..];
    }
    elements
}

/// The kinds of element drawn from a hash map, whose order is anyone's guess: the
/// constellations' boundaries, their figures and their names.
fn unordered(element: &str) -> Option<u8> {
    if element.starts_with("<path") && element.contains(r#"stroke-opacity="0.15""#) {
        Some(0)
    } else if element.starts_with("<path") && element.contains(r#"stroke-opacity="0.35""#) {
        Some(1)
    } else if element.starts_with("<text") && element.contains(r#" opacity="0.75""#) {
        Some(2)
    } else {
        None
    }
}

/// `svg` with every run of unordered elements sorted, and nothing else touched.
fn canonical(svg: &str) -> String {
    let elements = elements(svg);
    let mut out = String::with_capacity(svg.len());
    let mut at = 0;
    while at < elements.len() {
        let kind = unordered(elements[at]);
        let run = elements[at..]
            .iter()
            .take_while(|element| unordered(element) == kind)
            .count();
        let mut run: Vec<&str> = elements[at..at + run].to_vec();
        if kind.is_some() {
            run.sort_unstable();
        }
        at += run.len();
        out.extend(run);
    }
    assert_eq!(out.len(), svg.len(), "sorting loses nothing");
    out
}

/// What one case must come to.
struct Pin {
    name: &'static str,
    bytes: usize,
    exact: u64,
    shape: u64,
}

/// Holds every `(name, text)` to its pin, and names all that moved at once, each as
/// the line to put in the table if the move is meant.
fn assert_pinned(pins: &[Pin], actual: &[(&str, String)]) {
    if let Some(dir) = std::env::var_os("GOLDEN_DUMP") {
        for (name, text) in actual {
            let file = std::path::Path::new(&dir).join(name.replace('/', "-"));
            std::fs::write(&file, text).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
        }
    }
    let names = |pins: &[Pin]| pins.iter().map(|pin| pin.name).collect::<Vec<_>>();
    let cases: Vec<&str> = actual.iter().map(|(name, _)| *name).collect();
    assert_eq!(names(pins), cases, "the table and the cases are one list");

    let mut moved = String::new();
    for (pin, (name, text)) in pins.iter().zip(actual) {
        let (bytes, exact) = (text.len(), digest(text.as_bytes()));
        let shape = digest(shape(text).as_bytes());
        let same =
            shape == pin.shape && (!RECORDED_HERE || (bytes, exact) == (pin.bytes, pin.exact));
        if !same {
            moved.push_str(&format!(
                "\n    pin(\"{name}\", {bytes}, 0x{exact:016x}, 0x{shape:016x}),"
            ));
        }
    }
    assert!(moved.is_empty(), "THE OUTPUT HAS MOVED:{moved}\n");
}

const fn pin(name: &'static str, bytes: usize, exact: u64, shape: u64) -> Pin {
    Pin {
        name,
        bytes,
        exact,
        shape,
    }
}

// ---------------------------------------------------------------------------
// Fixtures: requests as a client writes them.
// ---------------------------------------------------------------------------

/// `base` with the value at each JSON pointer set, the key made if it is not there.
fn with(base: &Value, changes: &[(&str, Value)]) -> Value {
    let mut value = base.clone();
    for (pointer, change) in changes {
        let (parent, key) = pointer.rsplit_once('/').expect("a pointer starts with /");
        let parent = value
            .pointer_mut(parent)
            .unwrap_or_else(|| panic!("{pointer}: no such parent"));
        match parent {
            Value::Object(fields) => {
                fields.insert(key.to_string(), change.clone());
            }
            Value::Array(items) => items[key.parse::<usize>().unwrap()] = change.clone(),
            _ => panic!("{pointer}: the parent holds nothing"),
        }
    }
    value
}

/// `base` without the key at each JSON pointer.
fn without(base: &Value, pointers: &[&str]) -> Value {
    let mut value = base.clone();
    for pointer in pointers {
        let (parent, key) = pointer.rsplit_once('/').expect("a pointer starts with /");
        value
            .pointer_mut(parent)
            .and_then(Value::as_object_mut)
            .and_then(|fields| fields.remove(key))
            .unwrap_or_else(|| panic!("{pointer}: nothing to remove"));
    }
    value
}

const LAYERS: [&str; 11] = [
    "ecliptic",
    "equator",
    "galactic_equator",
    "planets",
    "horizontal_grid",
    "equatorial_grid",
    "constellations",
    "constellation_boundaries",
    "constellation_names",
    "zenith",
    "poles",
];

fn layers(on: &[&str]) -> Value {
    assert!(on.iter().all(|layer| LAYERS.contains(layer)));
    LAYERS
        .iter()
        .map(|layer| ((*layer).to_string(), json!(on.contains(layer))))
        .collect::<serde_json::Map<_, _>>()
        .into()
}

/// The observer's chart of the first generator: the sky over Moscow, no view.
fn observer_chart(projection: &str) -> Value {
    json!({
        "projection": projection,
        "datetime": "2024-06-14 06:10:00",
        "latitude": 55.75,
        "longitude": 37.62,
        "magnitude_limit": 5.5,
        "fov_deg": 60.0,
        "aspect_ratio": 1.5,
        "constellation": null,
        "tilt_angle": 0.0,
        "layers": layers(&[]),
        "style": {
            "star_color": "#FFFFFF", "constellation_line_color": "#808080",
            "grid_color": "#404040", "background_color": "#05050A",
            "font_family": "sans-serif", "magnitude_scale": 1.0
        },
        "print_info": false,
        "footer_text": null
    })
}

/// A chart as the page sends it: the preview's camera looking at Orion, east to the
/// right, sized in the preview's px.
fn view_chart(projection: &str) -> Value {
    let stereo = projection == "stereo";
    let ra = (5.6f64 * 15.0).to_radians();
    json!({
        "projection": projection,
        "datetime": "2026-05-20T12:00:00Z",
        "magnitude_limit": 5.5,
        "fov_deg": if stereo { 120.0 } else { 80.0 },
        "view": {
            "right": [-ra.sin(), ra.cos(), 0.0],
            "up": [0.0, 0.0, 1.0],
            "forward": [ra.cos(), ra.sin(), 0.0],
            "width": if stereo { 1104.0 } else { 1200.0 },
            "height": if stereo { 1104.0 } else { 650.0 }
        },
        "layers": layers(&[]),
        "style": {
            "star_color": "#000000", "constellation_line_color": "#808080",
            "grid_color": "#404040", "background_color": "#0a0a0b",
            "chart_color": "#ffffff", "font_family": "sans-serif", "magnitude_scale": 1.0
        },
        "print_info": false
    })
}

/// A chart as the document editor sends it: a view sized in mm, a fixed `px`, paper
/// styling.
fn paper_chart(projection: &str, width_mm: f64, height_mm: f64, on: &[&str]) -> Value {
    json!({
        "projection": projection,
        "datetime": "2024-01-01T00:00:00Z",
        "magnitude_limit": 4.5,
        "fov_deg": if projection == "stereo" { 120.0 } else { 70.0 },
        "view": {
            "right": [0.0, 1.0, 0.0], "up": [0.0, 0.0, 1.0], "forward": [1.0, 0.0, 0.0],
            "width": width_mm, "height": height_mm, "px": 186.0 / 1104.0
        },
        "layers": layers(on),
        "style": {
            "star_color": "#000000", "constellation_line_color": "#000000",
            "grid_color": "#000000", "background_color": "none",
            "chart_color": "#ffffff", "chart_outline": "#c9ced6",
            "font_family": "Inter", "magnitude_scale": 1.0
        }
    })
}

fn marks() -> Value {
    json!([
        { "ra_deg": 83.8, "dec_deg": -5.4, "radius_deg": 10.0 },
        { "ra_deg": 310.0, "dec_deg": 45.0, "radius_deg": 2.5 }
    ])
}

/// Every chart the pins hold, by name.
fn chart_cases() -> Vec<(&'static str, Value)> {
    let stereo = observer_chart("stereo");
    let pinhole = observer_chart("pinhole");
    let (stereo_view, pinhole_view) = (view_chart("stereo"), view_chart("pinhole"));
    let dressed = [
        ("/layers", layers(&LAYERS)),
        ("/style/chart_color", json!("#101820")),
        ("/style/chart_outline", json!("#c9ced6")),
        ("/style/magnitude_scale", json!(1.4)),
        ("/marks", marks()),
        ("/print_info", json!(true)),
        ("/footer_text", json!("Skycharts · golden")),
    ];
    let mut cases = vec![("stereo/bare", stereo.clone())];
    // One layer at a time, the two that draw nothing included.
    for layer in LAYERS {
        cases.push((
            match layer {
                "ecliptic" => "stereo/ecliptic",
                "equator" => "stereo/equator",
                "galactic_equator" => "stereo/galactic_equator",
                "planets" => "stereo/planets",
                "horizontal_grid" => "stereo/horizontal_grid",
                "equatorial_grid" => "stereo/equatorial_grid",
                "constellations" => "stereo/constellations",
                "constellation_boundaries" => "stereo/constellation_boundaries",
                "constellation_names" => "stereo/constellation_names",
                "zenith" => "stereo/zenith",
                _ => "stereo/poles",
            },
            with(&stereo, &[("/layers", layers(&[layer]))]),
        ));
    }
    cases.extend([
        ("stereo/everything", with(&stereo, &dressed)),
        (
            "stereo/southern",
            with(
                &stereo,
                &[
                    ("/latitude", json!(-33.92)),
                    ("/longitude", json!(-70.6)),
                    ("/datetime", json!("2025-06-02T01:30:00+03:00")),
                    ("/layers", layers(&["planets", "constellation_names"])),
                    ("/print_info", json!(true)),
                ],
            ),
        ),
        // Nothing but what must be there: the default time, limit and the rest.
        (
            "stereo/defaults",
            json!({
                "projection": "stereo", "latitude": 0.0, "longitude": 0.0,
                "layers": without(&layers(&["planets"]), &["/constellation_boundaries"]),
                "style": stereo["style"],
            }),
        ),
        (
            "stereo/bare-date",
            with(
                &stereo,
                &[
                    ("/datetime", json!("2025-03-01")),
                    ("/layers", layers(&["planets"])),
                    ("/print_info", json!(true)),
                ],
            ),
        ),
        (
            "stereo/unreadable-date",
            with(
                &stereo,
                &[
                    ("/datetime", json!("yesterday")),
                    ("/layers", layers(&["planets"])),
                    ("/print_info", json!(true)),
                ],
            ),
        ),
        (
            "stereo/magnitude-scale",
            with(
                &stereo,
                &[
                    ("/style/magnitude_scale", json!(0.5)),
                    ("/layers", layers(&["planets"])),
                ],
            ),
        ),
        ("pinhole/bare", pinhole.clone()),
        (
            "pinhole/orion",
            with(
                &pinhole,
                &[
                    ("/constellation", json!("ORI")),
                    (
                        "/layers",
                        layers(&[
                            "constellations",
                            "constellation_boundaries",
                            "constellation_names",
                        ]),
                    ),
                ],
            ),
        ),
        (
            "pinhole/direction",
            with(
                &pinhole,
                &[
                    ("/center_direction", json!([0.3, -0.5, 0.8])),
                    ("/tilt_angle", json!(30.0)),
                    ("/fov_deg", json!(90.0)),
                    ("/aspect_ratio", json!(1.0)),
                    ("/datetime", json!("2024-01-01 00:00:00")),
                    ("/magnitude_limit", json!(8.0)),
                    (
                        "/layers",
                        layers(&[
                            "ecliptic",
                            "equator",
                            "galactic_equator",
                            "planets",
                            "equatorial_grid",
                            "constellation_names",
                        ]),
                    ),
                ],
            ),
        ),
        // A direction aims the camera whatever constellation is named; the name
        // still picks the figure that is drawn.
        (
            "pinhole/direction-and-constellation",
            with(
                &pinhole,
                &[
                    ("/center_direction", json!([0.13, 0.99, 0.02])),
                    ("/constellation", json!("ORI")),
                    ("/layers", layers(&["constellations"])),
                ],
            ),
        ),
        (
            "pinhole/zero-direction",
            with(
                &pinhole,
                &[
                    ("/center_direction", json!([0.0, 0.0, 0.0])),
                    ("/constellation", json!("ORI")),
                    ("/layers", layers(&["constellations"])),
                ],
            ),
        ),
        (
            "pinhole/unknown-constellation",
            with(
                &pinhole,
                &[
                    ("/constellation", json!("XYZ")),
                    (
                        "/layers",
                        layers(&["constellations", "constellation_names"]),
                    ),
                ],
            ),
        ),
        (
            "pinhole/defaults",
            json!({
                "projection": "pinhole", "latitude": 10.0, "longitude": 20.0,
                "layers": layers(&["equator"]), "style": pinhole["style"],
            }),
        ),
        ("pinhole/everything", with(&pinhole, &dressed)),
        // A camera that cannot be set up sees nothing.
        (
            "pinhole/no-field",
            with(&pinhole, &[("/fov_deg", json!(0.0))]),
        ),
        (
            "view/stereo",
            with(
                &stereo_view,
                &[(
                    "/layers",
                    layers(&[
                        "ecliptic",
                        "equator",
                        "constellations",
                        "constellation_boundaries",
                    ]),
                )],
            ),
        ),
        (
            "view/pinhole",
            with(
                &pinhole_view,
                &[(
                    "/layers",
                    layers(&[
                        "ecliptic",
                        "equator",
                        "constellations",
                        "constellation_boundaries",
                    ]),
                )],
            ),
        ),
        ("view/stereo-everything", with(&stereo_view, &dressed)),
        ("view/pinhole-everything", with(&pinhole_view, &dressed)),
        (
            "view/stereo-on-paper",
            with(
                &paper_chart("stereo", 90.0, 90.0, &LAYERS),
                &[
                    ("/marks", marks()),
                    ("/latitude", json!(55.75)),
                    ("/longitude", json!(37.62)),
                    ("/print_info", json!(true)),
                    ("/footer_text", json!("Skycharts")),
                ],
            ),
        ),
        (
            "view/pinhole-on-paper",
            with(
                &paper_chart("pinhole", 90.0, 60.0, &LAYERS),
                &[("/marks", marks())],
            ),
        ),
        (
            "view/stereo-default-fov",
            without(&stereo_view, &["/fov_deg"]),
        ),
        (
            "view/pinhole-default-fov",
            without(&pinhole_view, &["/fov_deg"]),
        ),
        (
            "view/one-constellation",
            with(
                &stereo_view,
                &[
                    ("/constellation", json!("ORI")),
                    (
                        "/layers",
                        layers(&[
                            "constellations",
                            "constellation_boundaries",
                            "constellation_names",
                        ]),
                    ),
                ],
            ),
        ),
        (
            "view/magnitude-scale",
            with(
                &pinhole_view,
                &[
                    ("/style/magnitude_scale", json!(2.0)),
                    ("/layers", layers(&["planets"])),
                    ("/datetime", json!("2024-06-14 06:10:00")),
                ],
            ),
        ),
        // The observer's settings mean nothing to a view.
        (
            "view/with-an-observer",
            with(
                &pinhole_view,
                &[
                    ("/latitude", json!(-12.0)),
                    ("/longitude", json!(100.0)),
                    ("/center_direction", json!([0.0, 1.0, 0.0])),
                    ("/tilt_angle", json!(45.0)),
                    ("/aspect_ratio", json!(2.0)),
                    ("/layers", layers(&["zenith", "equatorial_grid"])),
                ],
            ),
        ),
    ]);
    cases
}

// ---------------------------------------------------------------------------
// The charts.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn every_chart_is_the_svg_it_was() {
    let app = subject::app();
    let mut actual = Vec::new();
    for (name, config) in chart_cases() {
        let reply = post(&app, "/api/export?format=svg", &config).await;
        assert_eq!(reply.status, StatusCode::OK, "{name}: {}", reply.text());
        actual.push((name, canonical(reply.text())));
    }
    assert_pinned(
        &[
            pin("stereo/bare", 86212, 0xe677b9dc04f213c8, 0xcea3ddb20460b7f7),
            pin(
                "stereo/ecliptic",
                90406,
                0x00db5e824af9da15,
                0x33a851dfe0bfae49,
            ),
            pin(
                "stereo/equator",
                90430,
                0x84e70cde5f4300c9,
                0xd905e5a256762d72,
            ),
            pin(
                "stereo/galactic_equator",
                90312,
                0x54c4244ae72a4223,
                0xc43f209db04423e6,
            ),
            pin(
                "stereo/planets",
                87129,
                0x358b39be1b666cbb,
                0x56bf25c5f728ddc6,
            ),
            pin(
                "stereo/horizontal_grid",
                86212,
                0xe677b9dc04f213c8,
                0xcea3ddb20460b7f7,
            ),
            pin(
                "stereo/equatorial_grid",
                143993,
                0xe5ea2672e8a10fb5,
                0x7a4ff8def8f1bc2b,
            ),
            pin(
                "stereo/constellations",
                138622,
                0xe171752011beb15a,
                0xe81becedc13dda63,
            ),
            pin(
                "stereo/constellation_boundaries",
                132642,
                0x30bfd2c077070b46,
                0xd8b7370430e01cf8,
            ),
            pin(
                "stereo/constellation_names",
                92368,
                0x6d49056cc2e7ef5d,
                0x9814a230c53f3967,
            ),
            pin(
                "stereo/zenith",
                86414,
                0xd9d70d7e0b3315b0,
                0xdeaebb535fc3061f,
            ),
            pin(
                "stereo/poles",
                86212,
                0xe677b9dc04f213c8,
                0xcea3ddb20460b7f7,
            ),
            pin(
                "stereo/everything",
                276051,
                0x54322c69910a9cbb,
                0xf3152b2ef706a7e1,
            ),
            pin(
                "stereo/southern",
                102006,
                0xb8518a2491e84704,
                0x592ce4c74f1bd494,
            ),
            pin(
                "stereo/defaults",
                276427,
                0x1371e1f13326d3bd,
                0x5c973a271d19e510,
            ),
            pin(
                "stereo/bare-date",
                87001,
                0x4208cb0e530f20ab,
                0x8744886783e0abb0,
            ),
            pin(
                "stereo/unreadable-date",
                87373,
                0x83b2607a7b5598fa,
                0x7967652890226ef0,
            ),
            pin(
                "stereo/magnitude-scale",
                86997,
                0x5d3d942c94600b5d,
                0x6e20de8893bc6245,
            ),
            pin("pinhole/bare", 6072, 0x9af6e4446949d6c2, 0xd8db13396074d97f),
            pin(
                "pinhole/orion",
                18650,
                0x11c241b50801f874,
                0x295a604c4e2bf173,
            ),
            pin(
                "pinhole/direction",
                100033,
                0x254377c33d9feaeb,
                0x4f85f3962c519512,
            ),
            pin(
                "pinhole/direction-and-constellation",
                16677,
                0xa0f957a03004c6ad,
                0x0fd31fe59a122c9b,
            ),
            pin(
                "pinhole/zero-direction",
                6072,
                0x9af6e4446949d6c2,
                0xd8db13396074d97f,
            ),
            pin(
                "pinhole/unknown-constellation",
                6072,
                0x9af6e4446949d6c2,
                0xd8db13396074d97f,
            ),
            pin(
                "pinhole/defaults",
                20564,
                0x65702edcd77ed01d,
                0xcd1753b101023925,
            ),
            pin(
                "pinhole/everything",
                22500,
                0x2699f2171eba3c6e,
                0xe8cece3c387f676b,
            ),
            pin(
                "pinhole/no-field",
                153,
                0x9d55f7b9ef46f65c,
                0xbfc0115246bfc899,
            ),
            pin(
                "view/stereo",
                228956,
                0x843588f9767d95b2,
                0xfbf59fe16b6a2581,
            ),
            pin(
                "view/pinhole",
                90170,
                0x0f9589ff43da0f9b,
                0x03c2da1e10d2600c,
            ),
            pin(
                "view/stereo-everything",
                361990,
                0xe009e89eb0905888,
                0xcaf5c4a7ace3902c,
            ),
            pin(
                "view/pinhole-everything",
                132933,
                0x59c2fa3df0d97299,
                0x5e79a31382ab6d97,
            ),
            pin(
                "view/stereo-on-paper",
                318880,
                0x349abacc00d4a671,
                0xada0f3c6d6fa7a6e,
            ),
            pin(
                "view/pinhole-on-paper",
                103316,
                0xd69bc0d141978110,
                0xae6511605e0e4c72,
            ),
            pin(
                "view/stereo-default-fov",
                84893,
                0x082684bf387a68f7,
                0x425538b041ba2ceb,
            ),
            pin(
                "view/pinhole-default-fov",
                12515,
                0x8d689e4ccb3b2742,
                0x742fbd4ceeb4b811,
            ),
            pin(
                "view/one-constellation",
                52010,
                0xe75c505233cd1fdc,
                0xe26be5ba0119bf43,
            ),
            pin(
                "view/magnitude-scale",
                19716,
                0x5a9b0dc2fa335dc7,
                0x41589d01bd5e2fc0,
            ),
            pin(
                "view/with-an-observer",
                46410,
                0xa537b3d99f3ebf44,
                0x1b06f060279f06b5,
            ),
        ],
        &actual,
    );
}

/// A chart small enough to read: the brightest stars in a narrow frame, spelled out.
#[tokio::test]
async fn a_small_chart_is_this_svg_to_the_letter() {
    let app = subject::app();
    let config = with(
        &observer_chart("pinhole"),
        &[
            ("/magnitude_limit", json!(1.0)),
            ("/constellation", json!("ORI")),
            ("/fov_deg", json!(40.0)),
            ("/style/chart_outline", json!("#c9ced6")),
            ("/footer_text", json!("Orion")),
        ],
    );
    let reply = post(&app, "/api/export?format=svg", &config).await;
    assert_eq!(
        reply.text(),
        concat!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="100%" height="100%">"##,
            r##"<rect width="100%" height="100%" fill="#05050A" />"##,
            r##"<g>"##,
            r##"<circle cx="797.22" cy="820.08" r="1.22" fill="#FFFFFF" />"##,
            r##"<circle cx="443.72" cy="271.89" r="1.10" fill="#FFFFFF" />"##,
            r##"</g>"##,
            r##"<rect x="0.5" y="0.5" width="1199" height="799" fill="none" stroke="#c9ced6" stroke-width="1" />"##,
            r##"<text x="600" y="785" fill="#606060" font-family="sans-serif" font-size="10" text-anchor="middle">Orion</text>"##,
            r##"</svg>"##
        )
    );
}

#[tokio::test]
async fn layers_that_draw_nothing_leave_the_chart_as_it_is() {
    let app = subject::app();
    let svg = |config: Value| {
        let app = app.clone();
        async move {
            let reply = post(&app, "/api/export?format=svg", &config).await;
            assert_eq!(reply.status, StatusCode::OK);
            reply.text().to_string()
        }
    };
    let stereo = observer_chart("stereo");
    let bare = svg(stereo.clone()).await;
    for layer in ["horizontal_grid", "poles"] {
        let drawn = svg(with(&stereo, &[("/layers", layers(&[layer]))])).await;
        assert_eq!(drawn, bare, "{layer}");
    }
    // The zenith cross is the horizon chart's alone.
    let pinhole = observer_chart("pinhole");
    assert_eq!(
        svg(with(&pinhole, &[("/layers", layers(&["zenith"]))])).await,
        svg(pinhole).await
    );
}

// ---------------------------------------------------------------------------
// The pages of a document.
// ---------------------------------------------------------------------------

/// A block of text with all it can carry: a turn, rules, cells with an anchor and a
/// weight of their own, a blank line, characters XML has no place for.
fn dressed_text() -> Value {
    json!({
        "font": "sans", "bold": true, "italic": true, "size_mm": 4.5, "anchor": "middle",
        "rotation_deg": -90.0, "cx_mm": 105.0, "cy_mm": 148.5,
        "lines": [
            { "x_mm": 105.0, "y_mm": 60.0, "text": "φ < 56° & \"LST\" > 13h" },
            { "x_mm": 105.0, "y_mm": 66.0, "text": "   " },
            { "x_mm": 105.0, "y_mm": 72.5, "text": "Широта\tи\u{7}время", "anchor": "end" },
            { "x_mm": 12.25, "y_mm": 78.0, "text": "Mag", "anchor": "middle", "bold": true },
            { "x_mm": 90.0, "y_mm": 78.0, "text": "4.0", "anchor": "start", "bold": false }
        ],
        "rules": [
            { "x1_mm": 12.0, "y1_mm": 101.5, "x2_mm": 90.0, "y2_mm": 101.5, "width_mm": 0.2 },
            { "x1_mm": 12.0, "y1_mm": 20.0, "x2_mm": 12.0, "y2_mm": 101.5, "width_mm": 0.35 }
        ]
    })
}

fn plain_text() -> Value {
    json!({
        "font": "serif", "size_mm": 3.5,
        "lines": [{ "x_mm": 12, "y_mm": 20, "text": "Key: 56° N, 13h 45m" }]
    })
}

#[test]
fn a_page_of_text_is_this_svg_to_the_letter() {
    let document = json!({ "pages": [
        { "width_mm": 210, "height_mm": 297, "texts": [dressed_text(), plain_text()] },
        { "width_mm": 297.5, "height_mm": 210, "items": [] }
    ] });
    let pages = subject::page_svgs(&document);
    assert_eq!(
        pages,
        [
            concat!(
                r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm">"##,
                r##"<g font-family="PT Sans" font-size="4.5" font-weight="700" font-style="italic" text-anchor="middle" fill="#000000" transform="rotate(-90 105 148.5)">"##,
                r##"<line x1="12" y1="101.5" x2="90" y2="101.5" stroke="#000000" stroke-width="0.2" />"##,
                r##"<line x1="12" y1="20" x2="12" y2="101.5" stroke="#000000" stroke-width="0.35" />"##,
                r##"<text x="105" y="60" xml:space="preserve">φ &lt; 56° &amp; "LST" &gt; 13h</text>"##,
                r##"<text x="105" y="72.5" text-anchor="end" xml:space="preserve">Широта и время</text>"##,
                r##"<text x="12.25" y="78" xml:space="preserve">Mag</text>"##,
                r##"<text x="90" y="78" text-anchor="start" font-weight="400" xml:space="preserve">4.0</text>"##,
                r##"</g>"##,
                r##"<g font-family="PT Serif" font-size="3.5" font-weight="400" font-style="normal" text-anchor="start" fill="#000000">"##,
                r##"<text x="12" y="20" xml:space="preserve">Key: 56° N, 13h 45m</text>"##,
                r##"</g>"##,
                r##"</svg>"##
            ),
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297.5 210" width="297.5mm" height="210mm"></svg>"##,
        ]
    );
}

#[test]
fn every_page_with_charts_is_the_svg_it_was() {
    let item = |x_mm: f64, y_mm: f64, config: Value| {
        json!({
            "x_mm": x_mm, "y_mm": y_mm,
            "width_mm": config["view"]["width"], "height_mm": config["view"]["height"],
            "config": config
        })
    };
    let sky = ["ecliptic", "equator", "planets", "constellations"];
    let document = json!({ "pages": [
        { "width_mm": 210, "height_mm": 297, "items": [
            item(12.0, 12.0, paper_chart("stereo", 90.0, 90.0, &sky)),
            item(108.0, 12.5, paper_chart("pinhole", 90.0, 60.0, &sky)),
        ] },
        { "width_mm": 297, "height_mm": 210, "items": [] },
        { "width_mm": 210, "height_mm": 297,
          "items": [
            item(12.0, 30.0, with(&paper_chart("stereo", 186.0, 186.0, &LAYERS), &[("/marks", marks())])),
            item(60.0, 222.0, paper_chart("pinhole", 90.0, 60.0, &[])),
          ],
          "texts": [dressed_text(), plain_text()] }
    ] });
    let pages = subject::page_svgs(&document);
    let actual: Vec<(&str, String)> = ["page/two-charts", "page/blank", "page/charts-and-text"]
        .into_iter()
        .zip(pages.iter().map(|svg| canonical(svg)))
        .collect();
    assert_pinned(
        &[
            pin(
                "page/two-charts",
                137372,
                0x4b67ce8c7c0e039f,
                0x8986ca591d83f9ce,
            ),
            pin("page/blank", 97, 0x09901a557ba8029a, 0xcc669edd28834df7),
            pin(
                "page/charts-and-text",
                324217,
                0x140b49eb20d38112,
                0xb9c930c542da3bd8,
            ),
        ],
        &actual,
    );
}

// ---------------------------------------------------------------------------
// The catalogues.
// ---------------------------------------------------------------------------

const CATALOG_CACHE: &str = "public, max-age=86400, stale-while-revalidate=604800";

#[tokio::test]
async fn every_catalogue_is_the_json_it_was() {
    let app = subject::app();
    let mut actual = Vec::new();
    for (uri, opening) in [
        (
            "/api/catalog/bright",
            r#"[{"v_mag":-1.44,"ra":1.7677944,"dec":-0.29175127},{"v_mag":-0.62,"#,
        ),
        (
            "/api/catalog/full",
            r#"[{"v_mag":-1.44,"ra":1.7677944,"dec":-0.29175127},{"v_mag":-0.62,"#,
        ),
        (
            "/api/catalog/messier",
            r#"[{"m":1,"name":"Crab Nebula","kind":"Supernova Remnant","constellation":"Tau","mag":8.4,"ra_deg":83."#,
        ),
        (
            "/api/constellations",
            r#"[{"abbr":"AND","segments":[[{"x":0.87326825,"y":0.031974144,"z":0.48618945},{"x":"#,
        ),
        (
            "/api/constellation-boundaries",
            r#"[{"abbr":"AND","segments":[[{"x":0.78"#,
        ),
    ] {
        let reply = get(&app, uri).await;
        assert_eq!(reply.status, StatusCode::OK, "{uri}");
        assert_eq!(reply.header(header::CONTENT_TYPE), Some("application/json"));
        assert_eq!(reply.header(header::CACHE_CONTROL), Some(CATALOG_CACHE));
        assert_eq!(reply.vary(), ["accept-encoding", CORS_VARY], "{uri}");
        assert_eq!(reply.header(header::CONTENT_ENCODING), None, "{uri}");
        // The tag is the body's FNV-1a: the same body, the same tag, on every run.
        let etag = format!("W/\"{:016x}\"", digest(&reply.body));
        assert_eq!(reply.header(header::ETAG), Some(etag.as_str()), "{uri}");
        // How an entry is spelled: its fields, in their order.
        assert!(
            reply.text().starts_with(opening),
            "{uri} opens with {:.200}",
            reply.text()
        );
        actual.push((uri, reply.text().to_string()));
    }
    // A slice of one's own is worked out on the spot and not cached.
    for uri in [
        "/api/catalog/full?max_mag=2.0",
        "/api/catalog/full?max_mag=3&min_mag=2.5",
        "/api/catalog/bright?max_mag=1.5",
        "/api/catalog/bright?min_mag=3.9",
        "/api/catalog/bright?max_mag=-5",
    ] {
        let reply = get(&app, uri).await;
        assert_eq!(reply.status, StatusCode::OK, "{uri}");
        assert_eq!(reply.header(header::CONTENT_TYPE), Some("application/json"));
        for absent in [header::CACHE_CONTROL, header::ETAG] {
            assert_eq!(reply.header(absent), None, "{uri}");
        }
        assert_eq!(reply.vary(), [CORS_VARY], "{uri}");
        actual.push((uri, reply.text().to_string()));
    }
    assert_pinned(
        &[
            pin(
                "/api/catalog/bright",
                24222,
                0x7953615e4dc13e2c,
                0xa3ed1561aad35a9d,
            ),
            pin(
                "/api/catalog/full",
                414359,
                0xe808b84817a98aa9,
                0x1dd2f566c4b5c09d,
            ),
            pin(
                "/api/catalog/messier",
                12496,
                0x332577e0409a8a1e,
                0xbd25e5c4bc16bdca,
            ),
            pin(
                "/api/constellations",
                46162,
                0x0c32d4563b5f71e5,
                0x1c7385f3c58cd45b,
            ),
            pin(
                "/api/constellation-boundaries",
                81369,
                0xa1b8fb6f19a6c422,
                0xb09f8e41760db75d,
            ),
            pin(
                "/api/catalog/full?max_mag=2.0",
                2297,
                0x1d12869977c35ba6,
                0x4b0ce0f058d24215,
            ),
            pin(
                "/api/catalog/full?max_mag=3&min_mag=2.5",
                3920,
                0xd022731c73b4b0b7,
                0x579d4a1c5dc48b3d,
            ),
            pin(
                "/api/catalog/bright?max_mag=1.5",
                1080,
                0xb638520d80db0636,
                0x38d53c29faff30f5,
            ),
            pin(
                "/api/catalog/bright?min_mag=3.9",
                2529,
                0x7e6da162822acb19,
                0xca3a1098cca6df9d,
            ),
            pin(
                "/api/catalog/bright?max_mag=-5",
                2,
                0x09612b07b5ecb5a5,
                0x09612b07b5ecb5a5,
            ),
        ],
        &actual,
    );
}

#[tokio::test]
async fn naming_the_default_limit_is_the_cached_answer() {
    let app = subject::app();
    for (default, named) in [
        ("/api/catalog/bright", "/api/catalog/bright?max_mag=4"),
        ("/api/catalog/full", "/api/catalog/full?max_mag=6.5"),
    ] {
        let (default, named) = (get(&app, default).await, get(&app, named).await);
        assert_eq!(named.header(header::ETAG), default.header(header::ETAG));
        assert_eq!(named.body, default.body);
    }
}

#[tokio::test]
async fn a_catalogue_query_that_is_no_number_is_refused() {
    let app = subject::app();
    for (uri, message) in [
        (
            "/api/catalog/bright?max_mag=bright",
            "Failed to deserialize query string: invalid float literal",
        ),
        (
            "/api/catalog/full?min_mag=",
            "Failed to deserialize query string: cannot parse float from empty string",
        ),
    ] {
        let reply = get(&app, uri).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(reply.header(header::CONTENT_TYPE), TEXT);
        assert_eq!(reply.text(), message, "{uri}");
    }
}

// ---------------------------------------------------------------------------
// The routes around them.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_small_routes_answer_as_they_did() {
    let app = subject::app();

    let root = get(&app, "/").await;
    assert_eq!(root.status, StatusCode::OK);
    assert_eq!(root.header(header::CONTENT_TYPE), TEXT);
    assert_eq!(root.text(), "Apex Backend is running!");

    let health = get(&app, "/api/health").await;
    assert_eq!(health.status, StatusCode::OK);
    assert_eq!(health.header(header::CONTENT_TYPE), TEXT);
    assert_eq!(health.text(), "ok");

    let generator = get(&app, "/generator").await;
    assert_eq!(generator.status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(generator.header(header::LOCATION), Some("/"));
    assert!(generator.body.is_empty());

    let nowhere = get(&app, "/api/nowhere").await;
    assert_eq!(nowhere.status, StatusCode::NOT_FOUND);
    assert!(nowhere.body.is_empty());

    // A route asked the wrong way says which way is right.
    for (uri, allow) in [("/api/export", "POST"), ("/api/export/document", "POST")] {
        let reply = get(&app, uri).await;
        assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED, "{uri}");
        assert_eq!(reply.header(header::ALLOW), Some(allow), "{uri}");
    }
    let reply = post(&app, "/api/catalog/bright", &json!({})).await;
    assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(reply.header(header::ALLOW), Some("GET,HEAD"));
}

#[tokio::test]
async fn any_origin_may_ask() {
    let app = subject::app();
    for uri in ["/api/health", "/api/catalog/messier", "/api/nowhere"] {
        let reply = get(&app, uri).await;
        assert_eq!(
            reply.header(header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some("*"),
            "{uri}"
        );
    }
    let preflight = Request::options("/api/export")
        .header(header::ORIGIN, "https://example.org")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
        .body(Body::empty())
        .unwrap();
    let reply = send(&app, preflight).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.header(header::ACCESS_CONTROL_ALLOW_ORIGIN), Some("*"));
    assert_eq!(
        reply.header(header::ACCESS_CONTROL_ALLOW_METHODS),
        Some("*")
    );
    assert_eq!(
        reply.header(header::ACCESS_CONTROL_ALLOW_HEADERS),
        Some("*")
    );
    assert!(reply.body.is_empty());
}

// ---------------------------------------------------------------------------
// A chart, asked for.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_chart_goes_out_as_svg_or_as_pdf() {
    let app = subject::app();
    let chart = view_chart("stereo");

    let svg = post(&app, "/api/export?format=svg", &chart).await;
    assert_eq!(svg.status, StatusCode::OK);
    assert_eq!(
        svg.header(header::CONTENT_TYPE),
        Some("image/svg+xml; charset=utf-8")
    );
    assert_eq!(svg.vary(), ["accept-encoding", CORS_VARY]);
    assert_eq!(svg.header(header::CONTENT_ENCODING), None);
    assert_eq!(svg.header(header::CONTENT_DISPOSITION), None);
    assert!(svg.text().starts_with(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1104 1104" width="100%" height="100%">"#
    ));

    // Anything but `svg` is the PDF.
    for uri in [
        "/api/export",
        "/api/export?format=pdf",
        "/api/export?format=SVG",
    ] {
        let pdf = post(&app, uri, &chart).await;
        assert_eq!(pdf.status, StatusCode::OK, "{uri}");
        assert_eq!(pdf.header(header::CONTENT_TYPE), Some("application/pdf"));
        assert_eq!(
            pdf.header(header::CONTENT_DISPOSITION),
            Some("attachment; filename=\"sky_chart.pdf\"")
        );
        assert_eq!(pdf.vary(), [CORS_VARY], "{uri}");
        assert!(pdf.body.starts_with(b"%PDF-"), "{uri}");
    }
}

/// Every refusal of a chart, in the order the checks are made, with its message.
fn chart_refusals() -> Vec<(&'static str, Value)> {
    let observer = observer_chart("stereo");
    let view = view_chart("stereo");
    let marks_of = |count: usize| {
        Value::from(vec![
            json!({ "ra_deg": 0.0, "dec_deg": 0.0, "radius_deg": 1.0 });
            count
        ])
    };
    let no_projection = "projection must be 'stereo' or 'pinhole'";
    let no_observer = "latitude and longitude are required without a view";
    let view_size = "view width and height must be at most 20000 px";
    let view_px = "view px must be in (0, 1000]";
    let no_camera = "view needs non-zero right, up and forward vectors, a positive size and a \
                     fov_deg the projection can show";
    let mark = "a mark needs a finite ra_deg, dec_deg in -90..=90 and radius_deg in (0, 90]";
    vec![
        (
            no_projection,
            with(&observer, &[("/projection", json!("cylindric"))]),
        ),
        (
            no_projection,
            with(&view, &[("/projection", json!("Stereo"))]),
        ),
        (no_projection, with(&view, &[("/projection", json!(""))])),
        (no_observer, without(&observer, &["/latitude"])),
        (no_observer, without(&observer, &["/longitude"])),
        (no_observer, with(&observer, &[("/latitude", Value::Null)])),
        (
            "latitude must be in -90..=90",
            with(&observer, &[("/latitude", json!(90.5))]),
        ),
        (
            "latitude must be in -90..=90",
            with(&view, &[("/latitude", json!(-123.0))]),
        ),
        (
            "longitude must be in -180..=180",
            with(&observer, &[("/longitude", json!(180.5))]),
        ),
        (
            "longitude must be in -180..=180",
            with(&view, &[("/longitude", json!(-181.0))]),
        ),
        (view_size, with(&view, &[("/view/width", json!(20000.5))])),
        (view_size, with(&view, &[("/view/height", json!(1.0e6))])),
        (view_px, with(&view, &[("/view/px", json!(0.0))])),
        (view_px, with(&view, &[("/view/px", json!(-1.0))])),
        (view_px, with(&view, &[("/view/px", json!(1000.5))])),
        (
            no_camera,
            with(&view, &[("/view/forward", json!([0.0, 0.0, 0.0]))]),
        ),
        (
            no_camera,
            with(&view, &[("/view/right", json!([0.0, 0.0, 0.0]))]),
        ),
        (no_camera, with(&view, &[("/view/width", json!(0.0))])),
        (no_camera, with(&view, &[("/view/height", json!(-650.0))])),
        (no_camera, with(&view, &[("/fov_deg", json!(0.0))])),
        (
            no_camera,
            with(&view_chart("pinhole"), &[("/fov_deg", json!(180.0))]),
        ),
        ("at most 16 marks", with(&view, &[("/marks", marks_of(17))])),
        (
            mark,
            with(
                &view,
                &[(
                    "/marks",
                    json!([{ "ra_deg": 0.0, "dec_deg": 91.0, "radius_deg": 10.0 }]),
                )],
            ),
        ),
        (
            mark,
            with(
                &view,
                &[(
                    "/marks",
                    json!([{ "ra_deg": 0.0, "dec_deg": 0.0, "radius_deg": 0.0 }]),
                )],
            ),
        ),
        (
            mark,
            with(
                &view,
                &[(
                    "/marks",
                    json!([{ "ra_deg": 0.0, "dec_deg": 0.0, "radius_deg": 90.5 }]),
                )],
            ),
        ),
        (
            mark,
            with(
                &observer,
                &[(
                    "/marks",
                    json!([{ "ra_deg": 0.0, "dec_deg": -90.5, "radius_deg": 1.0 }]),
                )],
            ),
        ),
        (
            "magnitude_limit must be in 0..=10",
            with(&observer, &[("/magnitude_limit", json!(10.5))]),
        ),
        (
            "magnitude_limit must be in 0..=10",
            with(&view, &[("/magnitude_limit", json!(-0.5))]),
        ),
        // The first fault found is the one named.
        (
            no_projection,
            with(
                &observer,
                &[
                    ("/projection", json!("mercator")),
                    ("/latitude", json!(123.0)),
                ],
            ),
        ),
        (
            "latitude must be in -90..=90",
            with(
                &observer,
                &[
                    ("/latitude", json!(123.0)),
                    ("/longitude", json!(999.0)),
                    ("/magnitude_limit", json!(99.0)),
                ],
            ),
        ),
        (
            view_size,
            with(
                &view,
                &[("/view/width", json!(30000.0)), ("/view/px", json!(0.0))],
            ),
        ),
        (
            view_px,
            with(
                &view,
                &[
                    ("/view/px", json!(0.0)),
                    ("/view/forward", json!([0.0, 0.0, 0.0])),
                ],
            ),
        ),
        (
            no_camera,
            with(
                &view,
                &[
                    ("/view/up", json!([0.0, 0.0, 0.0])),
                    ("/marks", marks_of(17)),
                ],
            ),
        ),
        (
            "at most 16 marks",
            with(
                &view,
                &[("/marks", marks_of(17)), ("/magnitude_limit", json!(11.0))],
            ),
        ),
    ]
}

#[tokio::test]
async fn a_chart_that_cannot_be_drawn_is_refused_with_the_reason() {
    for (message, config) in chart_refusals() {
        // Whatever the format asked for, and before anything is drawn.
        for uri in ["/api/export", "/api/export?format=svg"] {
            let reply = post(&subject::app(), uri, &config).await;
            assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{message}");
            assert_eq!(reply.header(header::CONTENT_TYPE), TEXT, "{message}");
            assert_eq!(reply.text(), message);
        }
    }
}

#[tokio::test]
async fn limits_are_inclusive_where_they_say_so() {
    let app = subject::app();
    let (observer, view) = (observer_chart("stereo"), view_chart("stereo"));
    let marks_of = |count: usize| {
        Value::from(vec![
            json!({ "ra_deg": 400.0, "dec_deg": 90.0, "radius_deg": 90.0 });
            count
        ])
    };
    for config in [
        with(
            &observer,
            &[("/latitude", json!(90.0)), ("/longitude", json!(-180.0))],
        ),
        with(
            &observer,
            &[("/latitude", json!(-90.0)), ("/longitude", json!(180.0))],
        ),
        with(&observer, &[("/magnitude_limit", json!(0.0))]),
        with(&observer, &[("/magnitude_limit", json!(10.0))]),
        with(
            &view,
            &[("/view/width", json!(20000.0)), ("/view/px", json!(1000.0))],
        ),
        with(&view, &[("/marks", marks_of(16))]),
    ] {
        let reply = post(&app, "/api/export?format=svg", &config).await;
        assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    }
}

#[tokio::test]
async fn a_body_that_is_no_chart_is_refused_by_the_reader() {
    let app = subject::app();
    let chart = observer_chart("stereo");

    let ask = |body: &str, content_type: Option<&str>| {
        let mut request = Request::post("/api/export?format=svg");
        if let Some(content_type) = content_type {
            request = request.header(header::CONTENT_TYPE, content_type);
        }
        send(&app, request.body(Body::from(body.to_string())).unwrap())
    };
    let json_type = Some("application/json");

    let cases = [
        (
            ask("{ not json", json_type).await,
            StatusCode::BAD_REQUEST,
            "Failed to parse the request body as JSON: key must be a string at line 1 column 3",
        ),
        (
            ask(&chart.to_string(), None).await,
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "Expected request with `Content-Type: application/json`",
        ),
        (
            ask(&without(&chart, &["/projection"]).to_string(), json_type).await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failed to deserialize the JSON body into the target type: missing field `projection` at line 1 column 618",
        ),
        (
            ask(&without(&chart, &["/layers/zenith"]).to_string(), json_type).await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failed to deserialize the JSON body into the target type: layers: missing field `zenith` at line 1 column 355",
        ),
        (
            ask(
                &without(&chart, &["/style/magnitude_scale"]).to_string(),
                json_type,
            )
            .await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failed to deserialize the JSON body into the target type: style: missing field `magnitude_scale` at line 1 column 600",
        ),
        (
            ask(
                &with(&chart, &[("/latitude", json!("north"))]).to_string(),
                json_type,
            )
            .await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failed to deserialize the JSON body into the target type: latitude: invalid type: string \"north\", expected f32 at line 1 column 126",
        ),
        (
            ask(
                &with(&chart, &[("/marks", json!([{ "ra_deg": 1.0 }]))]).to_string(),
                json_type,
            )
            .await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failed to deserialize the JSON body into the target type: marks[0]: missing field `dec_deg` at line 1 column 434",
        ),
    ];
    let mut moved = String::new();
    for (reply, status, message) in &cases {
        assert_eq!(reply.header(header::CONTENT_TYPE), TEXT);
        if (reply.status, reply.text()) != (*status, *message) {
            moved.push_str(&format!("\n{} {:?}", reply.status, reply.text()));
        }
    }
    assert!(moved.is_empty(), "{moved}");

    let format = Request::post("/api/export?format=svg&format=pdf")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(chart.to_string()))
        .unwrap();
    let reply = send(&app, format).await;
    assert_eq!(
        (reply.status, reply.text()),
        (
            StatusCode::BAD_REQUEST,
            "Failed to deserialize query string: duplicate field `format`"
        )
    );
}

#[tokio::test]
async fn a_chart_whose_text_breaks_the_svg_is_a_500_as_pdf_and_goes_out_as_svg() {
    let app = subject::app();
    let chart = with(&view_chart("stereo"), &[("/footer_text", json!("a < b"))]);
    let svg = post(&app, "/api/export?format=svg", &chart).await;
    assert_eq!(svg.status, StatusCode::OK);
    assert!(svg.text().contains(">a < b</text>"));
    let pdf = post(&app, "/api/export", &chart).await;
    assert_eq!(pdf.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(pdf.header(header::CONTENT_TYPE), TEXT);
    assert_eq!(
        pdf.text(),
        "SVG parsing error: SVG data parsing failed cause invalid name token at 1:47210"
    );
}

#[tokio::test]
async fn a_client_past_its_budget_is_told_when_to_come_back() {
    let app = subject::app();
    let from = |address: &'static str, uri: &'static str, body: Value| {
        let request = Request::post(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-real-ip", address)
            .body(Body::from(body.to_string()))
            .unwrap();
        send(&app, request)
    };
    // 400 charts at four units each are a client's whole burst, taken before the
    // document is looked at (and it is then refused as too large).
    let chart = json!({ "x_mm": 10.0, "y_mm": 10.0, "width_mm": 50.0, "height_mm": 50.0,
        "config": paper_chart("stereo", 50.0, 50.0, &[]) });
    let page = json!({ "width_mm": 210.0, "height_mm": 297.0, "items": vec![chart; 50] });
    let document = json!({ "pages": vec![page; 8] });
    let spent = from("203.0.113.9", "/api/export/document", document.clone()).await;
    assert_eq!(spent.status, StatusCode::BAD_REQUEST);
    assert_eq!(spent.text(), "a document holds at most 200 charts, got 400");

    for (uri, body, seconds) in [
        ("/api/export?format=svg", view_chart("stereo"), "1"),
        ("/api/export", view_chart("stereo"), "4"),
        ("/api/export/document", json!({ "pages": [] }), "4"),
        ("/api/export/document", document, "1600"),
    ] {
        let reply = from("203.0.113.9", uri, body).await;
        assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS, "{uri}");
        assert_eq!(reply.header(header::RETRY_AFTER), Some(seconds), "{uri}");
        assert_eq!(reply.header(header::CONTENT_TYPE), TEXT, "{uri}");
        assert_eq!(
            reply.text(),
            format!("too many exports; try again in {seconds} s"),
            "{uri}"
        );
    }
    // The budget is asked before the chart is read: a bad one is a 429 all the same.
    let bad = with(&view_chart("stereo"), &[("/projection", json!("mercator"))]);
    let reply = from("203.0.113.9", "/api/export?format=svg", bad.clone()).await;
    assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
    // Another visitor is not held back by this one.
    let reply = from("198.51.100.4", "/api/export?format=svg", bad).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
}

// ---------------------------------------------------------------------------
// A document, asked for.
// ---------------------------------------------------------------------------

fn page(items: Vec<Value>, texts: Vec<Value>) -> Value {
    json!({ "width_mm": 210.0, "height_mm": 297.0, "items": items, "texts": texts })
}

fn placed(x_mm: f64, y_mm: f64, width_mm: f64, height_mm: f64) -> Value {
    json!({ "x_mm": x_mm, "y_mm": y_mm, "width_mm": width_mm, "height_mm": height_mm,
        "config": paper_chart("stereo", width_mm, height_mm, &[]) })
}

fn document(pages: Vec<Value>) -> Value {
    json!({ "pages": pages })
}

fn text_of(lines: Vec<Value>) -> Value {
    json!({ "font": "serif", "size_mm": 4.0, "lines": lines })
}

fn line(x_mm: f64, y_mm: f64, text: &str) -> Value {
    json!({ "x_mm": x_mm, "y_mm": y_mm, "text": text })
}

/// Every refusal of a document, in the order the checks are made, with its message.
fn document_refusals() -> Vec<(String, Value)> {
    let chart = || placed(12.0, 12.0, 40.0, 40.0);
    let one = |item: Value| document(vec![page(vec![item], vec![])]);
    let texted = |text: Value| document(vec![page(vec![], vec![text])]);
    let good_line = || line(12.0, 20.0, "x");
    let side = "width_mm and height_mm must be positive and at most 2000";
    let mut refusals: Vec<(String, Value)> = vec![
        (
            "a document needs 1 to 100 pages, got 0".into(),
            document(vec![]),
        ),
        (
            "a document needs 1 to 100 pages, got 101".into(),
            document(vec![page(vec![], vec![]); 101]),
        ),
        (
            "a document holds at most 200 charts, got 201".into(),
            document(
                [
                    vec![page(vec![chart(); 50], vec![]); 4],
                    vec![page(vec![chart()], vec![])],
                ]
                .concat(),
            ),
        ),
        // The whole document's count comes before any page's.
        (
            "a document holds at most 200 charts, got 204".into(),
            document(vec![page(vec![chart(); 51], vec![]); 4]),
        ),
        (
            "page 1: at most 50 items, got 51".into(),
            document(vec![page(vec![chart(); 51], vec![])]),
        ),
        (
            "page 2: at most 50 texts, got 51".into(),
            document(vec![
                page(vec![], vec![]),
                page(vec![], vec![text_of(vec![good_line()]); 51]),
            ]),
        ),
    ];
    for (width, height) in [(0.0, 297.0), (-210.0, 297.0), (210.0, 2000.5), (210.0, 0.0)] {
        refusals.push((
            format!("page 2: {side}"),
            document(vec![
                page(vec![], vec![]),
                json!({ "width_mm": width, "height_mm": height }),
            ]),
        ));
    }
    for (width, height) in [(0.0, 40.0), (40.0, -1.0), (2001.0, 40.0)] {
        refusals.push((
            format!("page 1, item 2: {side}"),
            document(vec![page(
                vec![
                    chart(),
                    with(
                        &chart(),
                        &[("/width_mm", json!(width)), ("/height_mm", json!(height))],
                    ),
                ],
                vec![],
            )]),
        ));
    }
    for (x, y) in [(-1.5, 0.0), (0.0, -1.5), (121.5, 0.0), (0.0, 208.5)] {
        refusals.push((
            "page 1, item 1: the chart must lie inside its page".into(),
            one(placed(x, y, 90.0, 90.0)),
        ));
    }
    refusals.extend([
        (
            "page 1, item 1: config needs a view".into(),
            one(
                json!({ "x_mm": 12.0, "y_mm": 12.0, "width_mm": 90.0, "height_mm": 90.0,
                "config": observer_chart("stereo") }),
            ),
        ),
        (
            "page 3, item 2: projection must be 'stereo' or 'pinhole'".into(),
            document(vec![
                page(vec![], vec![]),
                page(vec![chart()], vec![]),
                page(
                    vec![
                        chart(),
                        with(&chart(), &[("/config/projection", json!("mercator"))]),
                    ],
                    vec![],
                ),
            ]),
        ),
        (
            "page 1, item 1: latitude must be in -90..=90".into(),
            one(with(&chart(), &[("/config/latitude", json!(91.0))])),
        ),
        (
            "page 1, item 1: longitude must be in -180..=180".into(),
            one(with(&chart(), &[("/config/longitude", json!(181.0))])),
        ),
        (
            "page 1, item 1: view width and height must be at most 20000 px".into(),
            one(with(&chart(), &[("/config/view/width", json!(20001.0))])),
        ),
        (
            "page 1, item 1: view px must be in (0, 1000]".into(),
            one(with(&chart(), &[("/config/view/px", json!(0.0))])),
        ),
        (
            "page 1, item 1: view needs non-zero right, up and forward vectors, a positive size \
             and a fov_deg the projection can show"
                .into(),
            one(with(
                &chart(),
                &[("/config/view/up", json!([0.0, 0.0, 0.0]))],
            )),
        ),
        (
            "page 1, item 1: at most 16 marks".into(),
            one(with(
                &chart(),
                &[(
                    "/config/marks",
                    Value::from(vec![
                        json!({ "ra_deg": 0.0, "dec_deg": 0.0, "radius_deg": 1.0 });
                        17
                    ]),
                )],
            )),
        ),
        (
            "page 1, item 1: a mark needs a finite ra_deg, dec_deg in -90..=90 and radius_deg in \
             (0, 90]"
                .into(),
            one(with(
                &chart(),
                &[(
                    "/config/marks",
                    json!([{ "ra_deg": 0.0, "dec_deg": 0.0, "radius_deg": 91.0 }]),
                )],
            )),
        ),
        (
            "page 1, item 1: magnitude_limit must be in 0..=10".into(),
            one(with(&chart(), &[("/config/magnitude_limit", json!(11.0))])),
        ),
        // A page's charts are read before its texts.
        (
            "page 1, item 1: config needs a view".into(),
            document(vec![page(
                vec![
                    json!({ "x_mm": 12.0, "y_mm": 12.0, "width_mm": 90.0, "height_mm": 90.0,
                    "config": observer_chart("stereo") }),
                ],
                vec![with(
                    &text_of(vec![good_line()]),
                    &[("/size_mm", json!(0.0))],
                )],
            )]),
        ),
    ]);
    for size_mm in [0.0, 0.5, 100.5] {
        refusals.push((
            "page 1, text 1: size_mm must be in 1..=100".into(),
            texted(with(
                &text_of(vec![good_line()]),
                &[("/size_mm", json!(size_mm))],
            )),
        ));
    }
    refusals.push((
        "page 1, text 2: at most 400 lines, got 401".into(),
        document(vec![page(
            vec![],
            vec![text_of(vec![good_line()]), text_of(vec![good_line(); 401])],
        )]),
    ));
    for field in ["/rotation_deg", "/cx_mm", "/cy_mm"] {
        refusals.push((
            "page 1, text 1: rotation_deg, cx_mm and cy_mm must be finite and within ±2000".into(),
            texted(with(
                &text_of(vec![good_line()]),
                &[(field, json!(-2000.5))],
            )),
        ));
    }
    let rule =
        json!({ "x1_mm": 12.0, "y1_mm": 101.5, "x2_mm": 90.0, "y2_mm": 101.5, "width_mm": 0.2 });
    refusals.push((
        "page 1, text 1: at most 100 rules, got 101".into(),
        texted(with(
            &text_of(vec![good_line()]),
            &[("/rules", Value::from(vec![rule.clone(); 101]))],
        )),
    ));
    for (field, value) in [
        ("/width_mm", 0.0),
        ("/width_mm", 5.5),
        ("/x2_mm", 2000.5),
        ("/y1_mm", -2001.0),
    ] {
        refusals.push((
            "page 1, text 1: rule 2: needs finite ends within ±2000 and a width_mm in (0, 5]"
                .into(),
            texted(with(
                &text_of(vec![good_line()]),
                &[(
                    "/rules",
                    json!([rule, with(&rule, &[(field, json!(value))])]),
                )],
            )),
        ));
    }
    for (x, y) in [(-1.5, 20.0), (211.5, 20.0), (12.0, 298.5), (12.0, -1.5)] {
        refusals.push((
            "page 1, text 1: line 2 must start inside its page".into(),
            texted(text_of(vec![good_line(), line(x, y, "out")])),
        ));
    }
    refusals.extend([
        // Where the turn puts a line is what counts.
        (
            "page 1, text 1: line 1 must start inside its page".into(),
            texted(with(
                &text_of(vec![good_line()]),
                &[("/rotation_deg", json!(180.0))],
            )),
        ),
        (
            "page 1, text 1: line 1: at most 400 characters, got 401".into(),
            texted(text_of(vec![line(12.0, 20.0, &"я".repeat(401))])),
        ),
        // Within a text: its size, its lines' count, its turn, its rules, then each line.
        (
            "page 1, text 1: size_mm must be in 1..=100".into(),
            texted(with(
                &text_of(vec![good_line(); 401]),
                &[("/size_mm", json!(0.0)), ("/rotation_deg", json!(1.0e9))],
            )),
        ),
        (
            "page 1, text 1: at most 400 lines, got 401".into(),
            texted(with(
                &text_of(vec![good_line(); 401]),
                &[("/rotation_deg", json!(1.0e9))],
            )),
        ),
        (
            "page 1, text 1: rotation_deg, cx_mm and cy_mm must be finite and within ±2000".into(),
            texted(with(
                &text_of(vec![good_line()]),
                &[
                    ("/cx_mm", json!(1.0e9)),
                    ("/rules", Value::from(vec![rule.clone(); 101])),
                ],
            )),
        ),
        (
            "page 1, text 1: rule 1: needs finite ends within ±2000 and a width_mm in (0, 5]"
                .into(),
            texted(with(
                &text_of(vec![line(-50.0, 20.0, "out")]),
                &[("/rules", json!([with(&rule, &[("/width_mm", json!(9.0))])]))],
            )),
        ),
    ]);
    refusals
}

#[tokio::test]
async fn a_document_that_cannot_be_made_is_refused_with_the_reason() {
    for (message, document) in document_refusals() {
        let reply = post(&subject::app(), "/api/export/document", &document).await;
        assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{message}");
        assert_eq!(reply.header(header::CONTENT_TYPE), TEXT, "{message}");
        assert_eq!(reply.text(), message);
    }
}

#[tokio::test]
async fn a_document_at_its_limits_is_made() {
    let app = subject::app();
    // A millimetre out on any side is rounding, and so is a line's start.
    let edges = [(-1.0, 0.0), (0.0, -1.0), (121.0, 0.0), (0.0, 208.0)]
        .map(|(x, y)| placed(x, y, 90.0, 90.0))
        .to_vec();
    let rule =
        json!({ "x1_mm": -2000.0, "y1_mm": 2000.0, "x2_mm": 0.0, "y2_mm": 0.0, "width_mm": 5.0 });
    let text = with(
        &text_of(vec![
            line(-1.0, -1.0, "in"),
            line(211.0, 298.0, &"я".repeat(400)),
        ]),
        &[
            ("/size_mm", json!(100.0)),
            ("/rules", Value::from(vec![rule; 100])),
        ],
    );
    let reply = post(
        &app,
        "/api/export/document",
        &document(vec![
            page(edges, vec![text]),
            json!({ "width_mm": 2000.0, "height_mm": 0.5 }),
        ]),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.text());
    assert_eq!(reply.header(header::CONTENT_TYPE), Some("application/pdf"));
    assert_eq!(
        reply.header(header::CONTENT_DISPOSITION),
        Some("attachment; filename=\"skycharts.pdf\"")
    );
    assert_eq!(reply.vary(), [CORS_VARY]);
    assert!(reply.body.starts_with(b"%PDF-"));
}

#[tokio::test]
async fn a_body_that_is_no_document_is_refused_by_the_reader() {
    let app = subject::app();
    let ask = |body: String| {
        let request = Request::post("/api/export/document")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body))
            .unwrap();
        send(&app, request)
    };
    let cases = [
        (
            ask("{}".into()).await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failed to deserialize the JSON body into the target type: missing field `pages` at line 1 column 2",
        ),
        (
            ask(json!({ "pages": [{ "width_mm": 210 }] }).to_string()).await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failed to deserialize the JSON body into the target type: pages[0]: missing field `height_mm` at line 1 column 26",
        ),
        (
            ask(document(vec![page(
                vec![],
                vec![json!({ "font": "mono", "size_mm": 4.0, "lines": [] })],
            )])
            .to_string())
            .await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failed to deserialize the JSON body into the target type: pages[0].texts[0].font: unknown variant `mono`, expected `serif` or `sans` at line 1 column 63",
        ),
        (
            ask(document(vec![page(
                vec![],
                vec![with(&text_of(vec![]), &[("/anchor", json!("left"))])],
            )])
            .to_string())
            .await,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Failed to deserialize the JSON body into the target type: pages[0].texts[0].anchor: unknown variant `left`, expected one of `start`, `middle`, `end` at line 1 column 65",
        ),
        // Two megabytes hold any document the editor can make; more is not read.
        (
            ask(json!({ "pages": [], "padding": "x".repeat(2 * 1024 * 1024) }).to_string()).await,
            StatusCode::PAYLOAD_TOO_LARGE,
            "Failed to buffer the request body: length limit exceeded",
        ),
    ];
    let mut moved = String::new();
    for (reply, status, message) in &cases {
        assert_eq!(reply.header(header::CONTENT_TYPE), TEXT);
        if (reply.status, reply.text()) != (*status, *message) {
            moved.push_str(&format!("\n{} {:?}", reply.status, reply.text()));
        }
    }
    assert!(moved.is_empty(), "{moved}");
}

/// A PDF with no text in it has no font in it, and its charts nothing drawn from a
/// hash map: the same file on every run, but for the order of some of its lines.
#[tokio::test]
async fn a_pdf_without_text_is_the_file_it_was() {
    let app = subject::app();
    let sky = [
        "ecliptic",
        "equator",
        "galactic_equator",
        "equatorial_grid",
        "planets",
    ];
    let chart = with(
        &view_chart("stereo"),
        &[("/layers", layers(&sky)), ("/marks", marks())],
    );
    let single = post(&app, "/api/export", &chart).await;
    assert_eq!(single.status, StatusCode::OK);

    let item = |x_mm: f64, y_mm: f64, config: Value| {
        json!({ "x_mm": x_mm, "y_mm": y_mm,
            "width_mm": config["view"]["width"], "height_mm": config["view"]["height"],
            "config": config })
    };
    let pages = document(vec![
        page(
            vec![
                item(12.0, 12.0, paper_chart("stereo", 90.0, 90.0, &sky)),
                item(108.0, 12.0, paper_chart("pinhole", 90.0, 60.0, &sky)),
            ],
            vec![],
        ),
        json!({ "width_mm": 297.0, "height_mm": 210.0 }),
    ]);
    let whole = post(&app, "/api/export/document", &pages).await;
    assert_eq!(whole.status, StatusCode::OK);
    // Its pages are the sizes asked for, in points, and in order.
    let text = String::from_utf8_lossy(&whole.body);
    assert!(text.contains("/Count 2"));
    assert!(text.contains("/Producer (Skycharts)"));

    // svg2pdf lists a page's resources in a hash map's order: the lines are the
    // same ones on every run, in another order.
    let sorted = |pdf: &[u8]| {
        let mut lines: Vec<&[u8]> = pdf.split(|&byte| byte == b'\n').collect();
        lines.sort_unstable();
        digest(&lines.concat())
    };
    if RECORDED_HERE {
        assert_eq!(
            [
                (single.body.len(), sorted(&single.body)),
                (whole.body.len(), sorted(&whole.body)),
            ],
            [(122200, 0x637224b91a276903), (89320, 0x65884f3e72955867)],
            "THE OUTPUT HAS MOVED"
        );
    }
}
