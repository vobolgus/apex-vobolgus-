use std::collections::HashMap;
use std::sync::OnceLock;

use rust_core::catalog::{HipCatalog, Star};
use rust_core::planets::{Body, all_positions};
use rust_core::projections::{ViewKind, ViewProjection};
use rust_core::time::julian_date;

use super::*;
use crate::request::{LayersConfig, RenderConfig, SkyMark, StyleConfig, ViewConfig};

fn baseline_config() -> RenderConfig {
    RenderConfig {
        projection: "stereo".to_string(),
        datetime: Some("2024-06-14 06:10:00".to_string()),
        latitude: Some(55.75),
        longitude: Some(37.62),
        magnitude_limit: Some(6.0),
        fov_deg: Some(60.0),
        aspect_ratio: Some(1.5),
        constellation: None,
        center_direction: None,
        tilt_angle: Some(0.0),
        view: None,
        layers: LayersConfig {
            ecliptic: false,
            equator: false,
            galactic_equator: false,
            planets: false, // intentional baseline fixture: layer disabled by default in generator tests
            horizontal_grid: false,
            equatorial_grid: false,
            constellations: false,
            constellation_boundaries: false,
            constellation_names: false,
            zenith: false,
            poles: false,
        },
        style: StyleConfig {
            star_color: "#FFFFFF".to_string(),
            constellation_line_color: "#808080".to_string(),
            grid_color: "#404040".to_string(),
            background_color: "#05050A".to_string(),
            chart_color: None,
            chart_outline: None,
            font_family: "sans-serif".to_string(),
            magnitude_scale: 1.0,
        },
        marks: vec![],
        print_info: Some(false),
        footer_text: None,
    }
}

fn hip_catalog() -> &'static HipCatalog {
    static HIP: OnceLock<HipCatalog> = OnceLock::new();
    HIP.get_or_init(HipCatalog::new)
}

/// `cfg` as a chart: every fixture here is one that can be drawn.
fn chart(cfg: &RenderConfig) -> Chart {
    Chart::try_from(cfg.clone()).expect("the fixture is a chart that can be drawn")
}

fn render(cfg: &RenderConfig) -> String {
    chart(cfg).to_svg(hip_catalog())
}

/// The camera of the view of `cfg`.
fn view_of(cfg: &RenderConfig) -> ViewProjection {
    *chart(cfg).view().expect("the fixture has a view")
}

fn count_occurrences(haystack: &str, needle: &str) -> usize {
    haystack.match_indices(needle).count()
}

#[test]
fn render_stereo_produces_svg_envelope() {
    let cfg = baseline_config();
    let svg = render(&cfg);

    assert!(svg.contains("<svg"), "must contain <svg>");
    assert!(svg.contains("</svg>"), "must contain </svg>");
}

#[test]
fn render_stereo_adds_clip_mask_and_border_elements() {
    let cfg = baseline_config();
    let svg = render(&cfg);

    assert!(svg.contains("clipPath id=\"sky-mask\""));
    assert!(svg.contains("<circle cx=\"400\" cy=\"400\" r=\"380\""));
    assert!(svg.contains(">N</text>"));
    assert!(svg.contains(">S</text>"));
}

#[test]
fn render_pinhole_produces_svg_without_stereo_mask() {
    let mut cfg = baseline_config();
    cfg.projection = "pinhole".to_string();
    cfg.fov_deg = Some(60.0);
    cfg.aspect_ratio = Some(1.5);
    cfg.constellation = Some("ORI".to_string());

    let svg = render(&cfg);

    assert!(svg.contains("<svg"));
    assert!(!svg.contains("sky-mask"));
}

#[test]
fn render_respects_magnitude_limit() {
    let mut cfg = baseline_config();

    cfg.magnitude_limit = Some(0.0);
    let svg_bright = render(&cfg);

    cfg.magnitude_limit = Some(6.0);
    let svg_full = render(&cfg);

    let bright_circles = count_occurrences(&svg_bright, "<circle cx=");
    let full_circles = count_occurrences(&svg_full, "<circle cx=");
    assert!(
        full_circles > bright_circles,
        "magnitude 6.0 should render more stars than 0.0"
    );
}

#[test]
fn render_with_equatorial_grid_layer_adds_paths() {
    let mut cfg = baseline_config();
    cfg.layers.equatorial_grid = true;

    let svg = render(&cfg);

    assert!(svg.contains("stroke-width=\"0.5\" stroke-opacity=\"0.25\""));
    assert!(count_occurrences(&svg, "<path d=") > 0);
}

#[test]
fn render_with_ecliptic_layer_adds_solid_path() {
    let mut cfg = baseline_config();
    cfg.layers.ecliptic = true;

    let svg = render(&cfg);

    assert!(svg.contains("stroke=\"#DC2626\""));
    assert!(!svg.contains("stroke=\"#DC2626\" stroke-width=\"2.4\" stroke-dasharray"));
}

#[test]
fn render_with_galactic_equator_layer_adds_solid_path() {
    let mut cfg = baseline_config();
    cfg.layers.galactic_equator = true;

    let svg = render(&cfg);

    assert!(
        svg.contains("stroke=\"#B58CFF\""),
        "expected galactic equator stroke color in SVG"
    );
    assert!(
        !svg.contains("stroke=\"#B58CFF\" stroke-width=\"2.4\" stroke-dasharray"),
        "galactic equator must be solid"
    );
}

#[test]
fn render_without_galactic_equator_omits_path() {
    let cfg = baseline_config();
    let svg = render(&cfg);
    assert!(!svg.contains("stroke=\"#B58CFF\""));
}

#[test]
fn render_with_constellation_layers_draws_lines_and_names() {
    let mut cfg = baseline_config();
    cfg.projection = "pinhole".to_string();
    cfg.constellation = Some("ORI".to_string());
    cfg.layers.constellations = true;
    cfg.layers.constellation_names = true;

    let svg = render(&cfg);

    // Lines are great-circle arcs in the constellation line style.
    assert!(svg.contains(r##"stroke="#808080" stroke-width="0.6" stroke-opacity="0.35""##));
    assert!(svg.contains("Орион"));
}

/// The generator preview's camera looking at Orion, east to the right as on screen.
fn view_config(projection: &str) -> RenderConfig {
    let mut cfg = baseline_config();
    cfg.projection = projection.to_string();
    cfg.latitude = None;
    cfg.longitude = None;
    let ra = 5.6f64.to_radians() * 15.0;
    cfg.view = Some(ViewConfig {
        right: [-ra.sin(), ra.cos(), 0.0],
        up: [0.0, 0.0, 1.0],
        forward: [ra.cos(), ra.sin(), 0.0],
        width: if projection == "stereo" {
            1104.0
        } else {
            1200.0
        },
        height: if projection == "stereo" {
            1104.0
        } else {
            650.0
        },
        px: None,
    });
    cfg.fov_deg = Some(if projection == "stereo" { 120.0 } else { 80.0 });
    cfg.style.background_color = "#0a0a0b".to_string();
    cfg.style.chart_color = Some("#ffffff".to_string());
    cfg.style.star_color = "#000000".to_string();
    cfg
}

#[test]
fn view_sizes_the_chart_and_fills_the_disc() {
    let svg = render(&view_config("stereo"));
    assert!(svg.contains(r#"viewBox="0 0 1104 1104""#));
    assert!(svg.contains(r##"<circle cx="552" cy="552" r="552" fill="#ffffff" />"##));
    // No horizon in a view: no compass letters and no horizon ring.
    assert!(!svg.contains(">N</text>"));
    assert!(!svg.contains(r#"stroke-width="2.5""#));
}

#[test]
fn view_keeps_only_the_stars_on_the_chart_at_the_preview_size() {
    let cfg = view_config("pinhole");
    let view = view_of(&cfg);
    let svg = render(&cfg);
    let stars: Vec<(f32, f32, f32)> = svg
        .split(r##"fill="#000000""##)
        .filter_map(|chunk| {
            let start = chunk.rfind("<circle ")?;
            let attr = |name: &str| -> Option<f32> {
                let at = chunk[start..].find(&format!("{name}=\""))? + start + name.len() + 2;
                chunk[at..].split('"').next()?.parse().ok()
            };
            Some((attr("cx")?, attr("cy")?, attr("r")?))
        })
        .collect();
    assert!(stars.len() > 50, "Orion at 80° shows plenty of stars");
    for (x, y, r) in &stars {
        assert!(view.touches_chart(*x, *y, *r));
        assert!(
            *r >= 0.5 && *r <= 4.0 + 0.75 * 1.5,
            "preview radii, got {r}"
        );
    }
}

#[test]
fn view_follows_the_basis_it_is_given() {
    // Betelgeuse (HIP 27989) is east of Rigel (HIP 24436): right of it with this basis.
    let catalog = hip_catalog();
    let stars: Vec<&Star> = catalog.stars(1.0, None).collect();
    let find = |hip: i32| stars.iter().find(|s| s.hip_id == hip).unwrap();
    let (betelgeuse, rigel) = (find(27989), find(24436));
    let cfg = view_config("pinhole");
    let view = view_of(&cfg);
    let b = view
        .project(betelgeuse.x, betelgeuse.y, betelgeuse.z)
        .unwrap();
    let r = view.project(rigel.x, rigel.y, rigel.z).unwrap();
    assert!(b.0 > r.0 && b.1 < r.1, "Betelgeuse upper right of Rigel");

    let mut mirrored = cfg.clone();
    let basis = mirrored.view.as_mut().unwrap();
    basis.right = basis.right.map(|c| -c);
    let view = view_of(&mirrored);
    let b = view
        .project(betelgeuse.x, betelgeuse.y, betelgeuse.z)
        .unwrap();
    let r = view.project(rigel.x, rigel.y, rigel.z).unwrap();
    assert!(b.0 < r.0, "a flipped right flips the chart");
}

#[test]
fn view_draws_constellation_boundaries_when_asked() {
    let mut cfg = view_config("stereo");
    cfg.style.constellation_line_color = "#000000".to_string();
    let boundary = r##"stroke="#000000" stroke-width="0.4" stroke-opacity="0.15""##;
    assert!(!render(&cfg).contains(boundary));
    cfg.layers.constellation_boundaries = true;
    assert!(render(&cfg).contains(boundary));
}

#[test]
fn a_mark_is_a_ring_round_its_place_and_none_when_off_the_chart() {
    let ring = r##"stroke="#d34b4b""##;
    let mut cfg = view_config("stereo");
    assert!(!render(&cfg).contains(ring));

    // The view looks at RA 5.6h on the equator (its `forward`): a ring there is whole.
    cfg.marks = vec![SkyMark {
        ra_deg: 5.6 * 15.0,
        dec_deg: 0.0,
        radius_deg: 10.0,
    }];
    let svg = render(&cfg);
    let path = elements(&svg)
        .into_iter()
        .find(|element| element.contains(ring))
        .expect("the ring is drawn");
    let d = attr_text(path, "d").unwrap();
    assert_eq!(d.matches(" L ").count(), 360, "one unbroken turn");
    assert_eq!(d.matches('M').count(), 1);
    // Round the middle of the chart: its points average out there.
    let numbers: Vec<f32> = d
        .split_whitespace()
        .filter_map(|word| word.parse().ok())
        .collect();
    let (xs, ys): (Vec<f32>, Vec<f32>) = numbers.chunks(2).map(|p| (p[0], p[1])).unzip();
    let mean = |values: &[f32]| values.iter().sum::<f32>() / values.len() as f32;
    let (width, height) = match &cfg.view {
        Some(view) => (view.width as f32, view.height as f32),
        None => unreachable!(),
    };
    assert!((mean(&xs) - width / 2.0).abs() < 1.0, "{}", mean(&xs));
    assert!((mean(&ys) - height / 2.0).abs() < 1.0, "{}", mean(&ys));
    // In the sky's own group, so the chart's edge clips it.
    assert!(svg.find(ring).unwrap() < svg.rfind("</g>").unwrap());

    // Behind the view there is nothing of it to draw.
    cfg.projection = "pinhole".to_string();
    cfg.fov_deg = Some(40.0);
    cfg.marks[0].ra_deg = 5.6 * 15.0 + 180.0;
    assert!(!render(&cfg).contains(ring));
}

/// The elements of an SVG, each without its leading `<`.
fn elements(svg: &str) -> Vec<&str> {
    svg.split('<').filter(|e| !e.is_empty()).collect()
}

fn attr_text<'a>(element: &'a str, name: &str) -> Option<&'a str> {
    let at = element.find(&format!(" {name}=\""))? + name.len() + 3;
    element[at..].split('"').next()
}

fn attr(element: &str, name: &str) -> Option<f32> {
    attr_text(element, name)?.parse().ok()
}

fn without_attrs(element: &str, names: &[&str]) -> String {
    let mut element = element.to_string();
    for name in names {
        if let Some(at) = element.find(&format!(" {name}=\"")) {
            let value_end = at + name.len() + 3 + element[at + name.len() + 3..].find('"').unwrap();
            element.replace_range(at..=value_end, "");
        }
    }
    element
}

#[test]
fn view_px_scales_star_radii_and_line_widths_in_place() {
    let mut cfg = view_config("stereo");
    cfg.layers.constellations = true;
    cfg.layers.constellation_boundaries = true;
    cfg.layers.ecliptic = true;
    cfg.layers.equator = true;
    // Mid-June the Sun, Mercury, Venus and Jupiter are around Orion.
    cfg.layers.planets = true;
    let with_px = |px: Option<f64>| {
        let mut cfg = cfg.clone();
        cfg.view.as_mut().unwrap().px = px;
        render(&cfg)
    };
    let base = with_px(None);
    assert_eq!(base, with_px(Some(1.0)), "px defaults to 1");
    let doubled = with_px(Some(2.0));
    let (base, doubled) = (elements(&base), elements(&doubled));

    let is_star = |e: &&str| e.starts_with("circle ") && e.contains(r##"fill="#000000""##);
    let is_planet = |e: &&str| e.contains("data-planet=");
    let stars = |svg: &[&str]| -> HashMap<(String, String), f32> {
        svg.iter()
            .filter(|e| is_star(e))
            .map(|e| {
                let at = |name| attr_text(e, name).unwrap().to_string();
                ((at("cx"), at("cy")), attr(e, "r").unwrap())
            })
            .collect()
    };

    // Stars stay where they are at twice the radius. A star just off the chart
    // may reach into it with the bigger radius, and only such a star is new.
    let (base_stars, doubled_stars) = (stars(&base), stars(&doubled));
    assert!(base_stars.len() > 100);
    let view = view_of(&cfg);
    for (position, r) in &doubled_stars {
        if let Some(base_r) = base_stars.get(position) {
            // Radii are printed to 0.01.
            assert!((r - 2.0 * base_r).abs() <= 0.015, "{position:?}");
        } else {
            let x: f32 = position.0.parse().unwrap();
            let y: f32 = position.1.parse().unwrap();
            assert!(!view.touches_chart(x, y, r / 2.0 - 0.02), "{position:?}");
        }
    }
    assert!(base_stars.keys().all(|p| doubled_stars.contains_key(p)));

    // Planets too, with their outline.
    let planets = |svg: &[&str]| -> Vec<(String, f32, f32)> {
        svg.iter()
            .filter(|e| is_planet(e))
            .map(|e| {
                let slug = attr_text(e, "data-planet").unwrap().to_string();
                (
                    slug,
                    attr(e, "r").unwrap(),
                    attr(e, "stroke-width").unwrap(),
                )
            })
            .collect()
    };
    let (base_planets, doubled_planets) = (planets(&base), planets(&doubled));
    assert!(base_planets.iter().any(|(slug, _, _)| slug == "sun"));
    assert_eq!(base_planets.len(), doubled_planets.len());
    for ((slug, r, width), (doubled_slug, doubled_r, doubled_width)) in
        base_planets.iter().zip(&doubled_planets)
    {
        assert_eq!(slug, doubled_slug);
        assert!((doubled_r - 2.0 * r).abs() <= 0.015, "{slug}");
        assert_eq!(*doubled_width, 2.0 * width, "{slug}");
    }

    // Every other element is the same, but for its stroke width, which doubles.
    // (This view draws no text; `view_px_scales_text_sizes_and_label_offsets`.)
    let is_rest = |e: &&str| !is_star(e) && !is_planet(e);
    let base_rest: Vec<&str> = base.into_iter().filter(is_rest).collect();
    let doubled_rest: Vec<&str> = doubled.into_iter().filter(is_rest).collect();
    assert_eq!(base_rest.len(), doubled_rest.len());
    let mut lines = 0;
    for (element, doubled) in base_rest.iter().zip(&doubled_rest) {
        assert_eq!(
            without_attrs(element, &["stroke-width"]),
            without_attrs(doubled, &["stroke-width"])
        );
        if let Some(width) = attr(element, "stroke-width") {
            assert_eq!(attr(doubled, "stroke-width"), Some(2.0 * width));
            lines += 1;
        }
    }
    assert!(lines > 50, "lines of every kind were compared, got {lines}");
}

#[test]
fn view_px_scales_text_sizes_and_label_offsets() {
    fn texts<'a>(svg: &[&'a str]) -> Vec<&'a str> {
        svg.iter()
            .copied()
            .filter(|e| e.starts_with("text "))
            .collect()
    }

    let mut cfg = view_config("stereo");
    cfg.layers.constellations = true;
    cfg.layers.constellation_names = true;
    cfg.layers.planets = true;
    cfg.latitude = Some(55.75);
    cfg.longitude = Some(37.62);
    cfg.print_info = Some(true);
    cfg.footer_text = Some("Skycharts".to_string());
    let with_px = |px: Option<f64>| {
        let mut cfg = cfg.clone();
        cfg.view.as_mut().unwrap().px = px;
        render(&cfg)
    };
    let (base, doubled) = (with_px(None), with_px(Some(2.0)));
    let (base, doubled) = (elements(&base), elements(&doubled));
    let planet = |svg: &[&str], slug: &str| -> (f32, f32) {
        let circle = svg
            .iter()
            .find(|e| attr_text(e, "data-planet") == Some(slug))
            .unwrap();
        (attr(circle, "cx").unwrap(), attr(circle, "cy").unwrap())
    };
    let (base_texts, doubled_texts) = (texts(&base), texts(&doubled));
    assert_eq!(base_texts.len(), doubled_texts.len());
    let close = |a: f32, b: f32| (a - b).abs() <= 0.02;
    let (mut names, mut labels, mut info) = (0, 0, 0);
    for (text, twice) in base_texts.iter().zip(&doubled_texts) {
        let size = attr(text, "font-size").unwrap();
        assert_eq!(attr(twice, "font-size"), Some(2.0 * size), "{text}");
        let (x, y) = (attr(text, "x").unwrap(), attr(text, "y").unwrap());
        let (x2, y2) = (attr(twice, "x").unwrap(), attr(twice, "y").unwrap());
        if let Some(slug) = attr_text(text, "data-planet-label") {
            // Off the planet's disc, which grows too: the offset from its centre doubles.
            let (cx, cy) = planet(&base, slug);
            let (cx2, cy2) = planet(&doubled, slug);
            assert!(close(x2 - cx2, 2.0 * (x - cx)), "{text}");
            assert!(close(cy2 - y2, 2.0 * (cy - y)), "{text}");
            labels += 1;
        } else if text.contains(r##"fill="#A0A0A0""##) || text.contains(r##"fill="#606060""##) {
            // The info lines and the footer: their distance from the bottom edge doubles.
            assert!(close(1104.0 - y2, 2.0 * (1104.0 - y)), "{text}");
            let centred = text.contains(r#"text-anchor="middle""#);
            assert!(close(x2, if centred { x } else { 2.0 * x }), "{text}");
            info += 1;
        } else {
            // A constellation name: 12 preview px under its centre, which stays.
            assert!(close(x2, x) && close(y2 - y, 12.0), "{text}");
            names += 1;
        }
    }
    assert!(
        names > 0 && labels > 0,
        "names {names}, planet labels {labels}"
    );
    assert_eq!(info, 3, "two info lines and the footer");
}

#[test]
fn chart_outline_strokes_the_sky_edge_one_preview_px_wide_inside_it() {
    let mut cfg = view_config("stereo");
    assert!(!render(&cfg).contains("#c9ced6"));
    cfg.style.chart_outline = Some("#c9ced6".to_string());
    cfg.view.as_mut().unwrap().px = Some(0.5);
    assert!(render(&cfg).contains(
        r##"<circle cx="552" cy="552" r="551.75" fill="none" stroke="#c9ced6" stroke-width="0.5" />"##
    ));

    let mut cfg = view_config("pinhole");
    cfg.style.chart_outline = Some("#c9ced6".to_string());
    cfg.view.as_mut().unwrap().px = Some(2.0);
    assert!(render(&cfg).contains(
        r##"<rect x="1" y="1" width="1198" height="648" fill="none" stroke="#c9ced6" stroke-width="2" />"##
    ));

    // Without a view, 1 px around the 800 px chart's disc.
    let mut cfg = baseline_config();
    cfg.style.chart_outline = Some("#c9ced6".to_string());
    assert!(render(&cfg).contains(
        r##"<circle cx="400" cy="400" r="379.5" fill="none" stroke="#c9ced6" stroke-width="1" />"##
    ));
}

#[test]
fn background_none_paints_nothing_behind_the_chart() {
    let mut cfg = view_config("pinhole");
    cfg.style.background_color = "none".to_string();
    let svg = render(&cfg);
    assert!(!svg.contains("fill=\"none\" />"), "no background rect");
    assert_eq!(
        svg.matches(r#"<rect width="100%" height="100%""#).count(),
        1,
        "only the sky's own fill"
    );
    assert!(svg.contains(r##"<rect width="100%" height="100%" fill="#ffffff" />"##));
    svg2pdf::usvg::Tree::from_str(&svg, &svg2pdf::usvg::Options::default())
        .expect("a chart without a background is still valid SVG");
}

#[test]
fn render_chart_prefixes_every_id_and_nests_at_the_placement() {
    let mut cfg = view_config("stereo");
    cfg.layers.planets = true;
    let standalone = render(&cfg);
    let mut nested = SvgWriter::new();
    chart(&cfg).write_nested(
        &mut nested,
        hip_catalog(),
        "p1c2-",
        Placement {
            x: 12.0,
            y: 20.5,
            width: 90.0,
            height: 90.0,
        },
    );
    let nested = String::from(nested);
    assert!(
        nested
            .starts_with(r#"<svg x="12" y="20.5" width="90" height="90" viewBox="0 0 1104 1104">"#)
    );

    let ids = |svg: &str| -> Vec<String> {
        svg.split(" id=\"")
            .skip(1)
            .map(|rest| rest.split('"').next().unwrap().to_string())
            .collect()
    };
    let standalone_ids = ids(&standalone);
    assert!(standalone_ids.contains(&"sky-mask".to_string()));
    assert!(standalone_ids.iter().any(|id| id.starts_with("planet-")));
    let prefixed: Vec<String> = standalone_ids
        .iter()
        .map(|id| format!("p1c2-{id}"))
        .collect();
    assert_eq!(ids(&nested), prefixed);
    assert!(nested.contains(r#"clip-path="url(#p1c2-sky-mask)""#));
    assert!(!nested.contains("url(#sky-mask)"));
}

/// Cross-language golden, as for the reference lines: the TypeScript preview is
/// tested against this exact JSON, so a view exports where the preview draws it.
#[test]
fn golden_view_projection_matches_the_preview() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/assets/golden/view-projection.json"
    );
    let raw = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("cannot read golden file {path}: {e}"));
    let golden: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let tolerance = golden["tolerance_px"].as_f64().unwrap();
    let vec3 =
        |v: &serde_json::Value| -> [f64; 3] { std::array::from_fn(|i| v[i].as_f64().unwrap()) };
    let cases = golden["cases"].as_array().unwrap();
    assert!(cases.len() >= 4);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let kind = if case["projection"] == "stereo" {
            ViewKind::Stereo
        } else {
            ViewKind::Pinhole
        };
        let view = ViewProjection::new(
            kind,
            vec3(&case["right"]),
            vec3(&case["up"]),
            vec3(&case["forward"]),
            case["fov_deg"].as_f64().unwrap(),
            case["width"].as_f64().unwrap(),
            case["height"].as_f64().unwrap(),
        )
        .unwrap_or_else(|_| panic!("{name}: the golden camera must be valid"));
        let (half_w, half_h) = view.half_extent();
        for point in case["points"].as_array().unwrap() {
            let [x, y, z] = vec3(&point["sky"]);
            let expected = [
                point["px"][0].as_f64().unwrap(),
                point["px"][1].as_f64().unwrap(),
            ];
            let (nx, ny) = view
                .normalized(x, y, z)
                .unwrap_or_else(|| panic!("{name}: {:?} must project", point["sky"]));
            let actual = [
                view.width() * 0.5 + nx * half_w,
                view.height() * 0.5 - ny * half_h,
            ];
            for axis in 0..2 {
                assert!(
                    (actual[axis] - expected[axis]).abs() <= tolerance,
                    "RUST AND TYPESCRIPT HAVE DRIFTED: {name}, point {:?}, {} is {} in the export and {} in the preview",
                    point["sky"],
                    ["x", "y"][axis],
                    actual[axis],
                    expected[axis]
                );
            }
        }
    }
}

#[test]
fn render_with_info_and_footer_prints_labels() {
    let mut cfg = baseline_config();
    cfg.print_info = Some(true);
    cfg.footer_text = Some("Unit test footer".to_string());

    let svg = render(&cfg);

    assert!(svg.contains("Lat:"));
    assert!(svg.contains("Lon:"));
    assert!(svg.contains("Time:"));
    assert!(svg.contains("Unit test footer"));
}

#[test]
fn test_planets_layer_off_no_circles() {
    let mut cfg = baseline_config();
    cfg.layers.planets = false;

    let svg = render(&cfg);
    assert!(
        !svg.contains("data-planet="),
        "no planet markers should be emitted when layer is off"
    );
}

#[test]
fn test_planets_layer_on_renders_visible() {
    let mut cfg = baseline_config();
    cfg.projection = "pinhole".to_string();
    cfg.fov_deg = Some(170.0);
    cfg.aspect_ratio = Some(1.0);
    cfg.center_direction = Some([1.0, 0.0, 0.0]);
    cfg.layers.planets = true;
    cfg.layers.constellation_names = true;
    cfg.datetime = Some("2024-01-01 00:00:00".to_string());
    cfg.magnitude_limit = Some(8.0);

    let svg = render(&cfg);
    let count = count_occurrences(&svg, "data-planet=");
    assert!(
        count >= 4,
        "expected at least 4 visible planets, got {count}"
    );
}

#[test]
fn test_planets_in_pinhole() {
    let jd = julian_date(2024, 1, 1);
    let jupiter = all_positions(jd)
        .into_iter()
        .find(|p| p.body == Body::Jupiter)
        .expect("Jupiter must exist in planet batch");

    let mut cfg = baseline_config();
    cfg.projection = "pinhole".to_string();
    cfg.fov_deg = Some(45.0);
    cfg.aspect_ratio = Some(1.0);
    cfg.datetime = Some("2024-01-01 00:00:00".to_string());
    cfg.center_direction = Some([
        jupiter.unit_vector[0] as f32,
        jupiter.unit_vector[1] as f32,
        jupiter.unit_vector[2] as f32,
    ]);
    cfg.layers.planets = true;

    let svg = render(&cfg);
    assert!(
        svg.contains("data-planet=\"jupiter\""),
        "expected Jupiter marker in pinhole projection"
    );
}

/// A chart with a view and nothing else that could be at fault.
fn sound_config() -> RenderConfig {
    serde_json::from_value(serde_json::json!({
        "projection": "stereo", "latitude": 55.0, "longitude": 37.0,
        "layers": {
            "ecliptic": false, "equator": false, "galactic_equator": false, "planets": false,
            "horizontal_grid": false, "equatorial_grid": false, "constellations": false,
            "constellation_names": false, "zenith": false, "poles": false
        },
        "style": {
            "star_color": "#000", "constellation_line_color": "#000", "grid_color": "#000",
            "background_color": "none", "font_family": "Inter", "magnitude_scale": 1.0
        }
    }))
    .unwrap()
}

fn refused(config: RenderConfig) -> ChartError {
    Chart::try_from(config).expect_err("the chart must be refused")
}

#[test]
fn marks_are_checked() {
    let base = sound_config();
    // A config from before marks were has none.
    assert!(base.marks.is_empty());
    let with = |ra_deg: f64, dec_deg: f64, radius_deg: f64| {
        let mut config = base.clone();
        config.marks = vec![SkyMark {
            ra_deg,
            dec_deg,
            radius_deg,
        }];
        Chart::try_from(config).map(drop)
    };
    assert_eq!(with(83.8, -5.4, 10.0), Ok(()));
    for (ra, dec, radius) in [
        (f64::NAN, 0.0, 10.0),
        (0.0, 91.0, 10.0),
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 90.5),
    ] {
        assert_eq!(with(ra, dec, radius), Err(ChartError::Mark));
    }
    assert!(ChartError::Mark.to_string().starts_with("a mark needs"));
    let mut many = base.clone();
    many.marks = vec![
        SkyMark {
            ra_deg: 0.0,
            dec_deg: 0.0,
            radius_deg: 1.0
        };
        MAX_MARKS + 1
    ];
    assert_eq!(refused(many).to_string(), "at most 16 marks");
}

#[test]
fn a_projection_is_one_of_two_names() {
    assert_eq!("stereo".parse(), Ok(Projection::Stereo));
    assert_eq!("pinhole".parse(), Ok(Projection::Pinhole));
    for name in ["Stereo", "mercator", ""] {
        assert_eq!(
            name.parse::<Projection>(),
            Err(ChartError::UnknownProjection)
        );
    }
    let mut config = sound_config();
    config.projection = "mercator".to_string();
    assert_eq!(refused(config), ChartError::UnknownProjection);
}

#[test]
fn a_chart_needs_an_observer_or_a_view() {
    let mut config = sound_config();
    config.longitude = None;
    assert_eq!(refused(config.clone()), ChartError::NoObserver);
    // A view of a size that is no number is no view either.
    config.view = Some(ViewConfig {
        right: [0.0, 1.0, 0.0],
        up: [0.0, 0.0, 1.0],
        forward: [1.0, 0.0, 0.0],
        width: f64::NAN,
        height: 600.0,
        px: None,
    });
    assert_eq!(refused(config.clone()), ChartError::ViewTooLarge);
    config.view.as_mut().unwrap().width = 800.0;
    assert!(Chart::try_from(config.clone()).is_ok());
    config.view.as_mut().unwrap().px = Some(f64::NAN);
    assert_eq!(refused(config), ChartError::ViewPx);
}
