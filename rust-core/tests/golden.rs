//! Pins the numeric output of the public API bit for bit.
//!
//! A refactor that reorders a sum, folds a constant differently or drops a cast
//! moves a planet or a star by a few ulps; the printed chart rounds most of that
//! away, but not all of it. So every value here is compared by its bits: a few
//! explicit ones to read when something breaks, and digests over sweeps of real
//! catalogue stars and instants to catch what the explicit ones miss.

use rust_core::planets::{Body, all_positions, body_color, position};
use rust_core::{
    CameraConfig, DateTime, HipCatalog, MessierCatalog, PinholeProjection, StereoProjection,
    ViewKind, ViewProjection, get_sidereal_time, julian_date, ra_dec_to_unit_vector,
    vequinox_hour_angle,
};

/// FNV-1a over the bits of what it is fed: the same values in the same order give
/// the same number, and anything else almost surely does not.
struct Digest(u64);

impl Digest {
    fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }

    fn bytes(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.0 ^= u64::from(byte);
            self.0 = self.0.wrapping_mul(0x0100_0000_01b3);
        }
    }

    fn f64(&mut self, value: f64) {
        self.bytes(&value.to_bits().to_le_bytes());
    }

    fn f32(&mut self, value: f32) {
        self.bytes(&value.to_bits().to_le_bytes());
    }

    fn i32(&mut self, value: i32) {
        self.bytes(&value.to_le_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.bytes(&value.to_le_bytes());
    }

    fn str(&mut self, value: &str) {
        self.bytes(&(value.len() as u64).to_le_bytes());
        self.bytes(value.as_bytes());
    }

    /// A marker for a point that does not project, so `None` counts too.
    fn none(&mut self) {
        self.bytes(&[0]);
    }

    fn some(&mut self) {
        self.bytes(&[1]);
    }
}

fn same_f64(actual: f64, expected: f64) -> bool {
    actual.to_bits() == expected.to_bits()
}

fn same_f32(actual: f32, expected: f32) -> bool {
    actual.to_bits() == expected.to_bits()
}

/// The points every projection is swept over: the catalogue's stars to magnitude
/// 4.5 as charts draw them, and a few that test the edges (the poles, a vector
/// that is not of unit length, the origin).
fn sweep_points() -> Vec<(f32, f32, f32)> {
    let catalog = HipCatalog::new();
    catalog
        .iter_stars(4.5, None)
        .map(|star| (star.x, star.y, star.z))
        .chain([
            (0.0, 0.0, 1.0),
            (0.0, 0.0, -1.0),
            (1.0, 0.0, 0.0),
            (-1.0, 0.0, 0.0),
            (0.0, 1.0, 0.0),
            (0.6, -0.8, 2.5),
            (0.0, 0.0, 0.0),
        ])
        .collect()
}

#[test]
fn julian_dates() {
    const PINNED: [((i32, u32, u32), f64); 9] = [
        ((2000, 1, 1), 2451544.5),
        ((1970, 1, 1), 2440587.5),
        ((1582, 10, 4), 2299159.5),
        ((1582, 10, 15), 2299160.5),
        ((1900, 2, 28), 2415078.5),
        ((2024, 2, 29), 2460369.5),
        ((-4712, 1, 1), -0.5),
        ((2100, 12, 31), 2488433.5),
        ((1, 1, 1), 1721423.5),
    ];
    for ((year, month, day), expected) in PINNED {
        let actual = julian_date(year, month, day);
        assert!(
            same_f64(actual, expected),
            "julian_date({year}, {month}, {day}) = {actual:?}, pinned {expected:?}"
        );
    }
}

#[test]
fn sidereal_times_and_hour_angles() {
    /// Year, month, day, hour, minute, second.
    type Civil = (i32, u32, u32, u32, u32, u32);
    // (date and time, sidereal time in hours, hour angle of the equinox in radians)
    const PINNED: [(Civil, f64, f64); 6] = [
        (
            (2024, 6, 14, 6, 10, 0),
            23.70248322927463,
            6.205295598743704,
        ),
        (
            (2000, 1, 1, 12, 0, 0),
            18.697354474327806,
            4.894955954842707,
        ),
        (
            (1999, 12, 31, 23, 59, 59),
            6.664213458338107,
            1.744687003555769,
        ),
        (
            (2024, 2, 29, 0, 0, 0),
            10.553693429274631,
            2.7629504788040045,
        ),
        (
            (1900, 1, 1, 0, 0, 0),
            6.6789204888158835,
            1.7485372951311942,
        ),
        (
            (2050, 7, 4, 18, 30, 15),
            13.368450923011556,
            3.4998522674673995,
        ),
    ];
    for ((year, month, day, hour, minute, second), hours, radians) in PINNED {
        let at = DateTime::new(year, month, day, hour, minute, second);
        for longitude in [0.0, 1.234, -2.5] {
            let lst = get_sidereal_time(longitude, at);
            assert!(
                same_f64(lst, hours),
                "sidereal time at {at:?}, longitude {longitude} = {lst:?}, pinned {hours:?}"
            );
            let angle = vequinox_hour_angle(longitude, at);
            assert!(
                same_f64(angle, radians),
                "hour angle at {at:?}, longitude {longitude} = {angle:?}, pinned {radians:?}"
            );
        }
    }
}

#[test]
fn unit_vectors() {
    /// RA and Dec in radians, and the unit vector they give.
    type Pin = ((f32, f32), (f32, f32, f32));
    const PINNED: [Pin; 5] = [
        ((0.0, 0.0), (1.0, 0.0, 0.0)),
        ((1.0, 0.5), (0.47415984, 0.73846024, 0.47942555)),
        ((4.0, -1.2), (-0.2368528, -0.27423322, -0.9320391)),
        ((6.0, 1.5707964), (-4.1970374e-8, 1.2213639e-8, 1.0)),
        ((-0.3, -1.5), (0.06757783, -0.020904273, -0.997495)),
    ];
    for ((ra, dec), (x, y, z)) in PINNED {
        let actual = ra_dec_to_unit_vector(ra, dec);
        assert!(
            same_f32(actual.0, x) && same_f32(actual.1, y) && same_f32(actual.2, z),
            "ra_dec_to_unit_vector({ra}, {dec}) = {actual:?}, pinned {:?}",
            (x, y, z)
        );
    }
}

#[test]
fn planet_positions_at_fixed_instants() {
    // (body, Julian Date, RA, Dec, unit vector, magnitude)
    #[rustfmt::skip]
    const PINNED: [(Body, f64, f64, f64, [f64; 3], f64); 20] = [
        (Body::Sun, 2451545.0, 4.90930537434842, -0.4020183955675949, [0.18004798622272708, -0.9024884124380191, -0.39127661324470275], -26.7),
        (Body::Mercury, 2451545.0, 4.748920015893084, -0.426229719425596, [0.0332552427247627, -0.909923513579246, -0.4134407917307107], -0.42),
        (Body::Venus, 2451545.0, 4.187133909184764, -0.32206755341458937, [-0.47565149389680844, -0.8207102878391429, -0.31652848179701876], -4.6),
        (Body::Earth, 2451545.0, 0.0, 0.0, [0.0, 0.0, 0.0], 0.0),
        (Body::Moon, 2451545.0, 3.88243632496632, -0.19023623220316266, [-0.7245874128574337, -0.6627350328265907, -0.18909087072862274], -12.74),
        (Body::Mars, 2451545.0, 5.7689436462067105, -0.22998289619938636, [0.8477416012550972, -0.47892381356743796, -0.22796087010595859], -1.6),
        (Body::Jupiter, 2451545.0, 0.4183492402172626, 0.15068461586800103, [0.9034065650409043, 0.40164917188902605, 0.15011502576975363], -2.94),
        (Body::Saturn, 2451545.0, 0.6735200116748997, 0.2191623935232237, [0.7629342444066355, 0.6088212422786743, 0.21741212859895384], 0.46),
        (Body::Uranus, 2451545.0, 5.540633231342349, -0.2971111904372534, [0.7044657120992084, -0.646544751617825, -0.29275919222460006], 5.32),
        (Body::Neptune, 2451545.0, 5.330796257828072, -0.33539133594076, [0.5474360471892173, -0.7694033227314577, -0.32913872638697067], 7.78),
        (Body::Sun, 2460310.75, 4.907877181041476, -0.4021206207573683, [0.17875110469826727, -0.9027053940675809, -0.39137068629426347], -26.7),
        (Body::Mercury, 2460310.75, 4.5621183884179075, -0.35159381487437263, [-0.1405474361537414, -0.9282450145052606, -0.34439455750162257], -0.42),
        (Body::Venus, 2460310.75, 4.204987157255497, -0.3276145998627351, [-0.46006388235032364, -0.8275236360535684, -0.32178541907524144], -4.6),
        (Body::Earth, 2460310.75, 0.0, 0.0, [0.0, 0.0, 0.0], 0.0),
        (Body::Moon, 2460310.75, 2.8246130057609893, 0.19804974552213694, [-0.9316072079108566, 0.30560508318075813, 0.19675757495613705], -12.74),
        (Body::Mars, 2460310.75, 4.658288624643134, -0.4181589197603776, [-0.04941485375669517, -0.9125011054080627, -0.40607869293681026], -1.6),
        (Body::Jupiter, 2460310.75, 0.581246563179579, 0.21168055649596573, [0.8171236053896291, 0.5368106199358113, 0.21010324090595034], -2.94),
        (Body::Saturn, 2460310.75, 5.855668455701549, -0.2084105249652898, [0.8903066685693339, -0.405640633038189, -0.20690508144884098], 0.46),
        (Body::Uranus, 2460310.75, 0.8150871617452736, 0.3000515734873402, [0.6551640504541144, 0.6952688340999817, 0.29556947630262925], 5.32),
        (Body::Neptune, 2460310.75, 6.207545812051263, -0.056281392810522496, [0.99556184482906, -0.07544773743920434, -0.05625168473800286], 7.78),
    ];
    for (body, jd, ra, dec, unit_vector, magnitude) in PINNED {
        let actual = position(body, jd);
        assert_eq!(actual.body, body);
        assert!(
            same_f64(actual.ra_radians, ra)
                && same_f64(actual.dec_radians, dec)
                && same_f64(actual.unit_vector[0], unit_vector[0])
                && same_f64(actual.unit_vector[1], unit_vector[1])
                && same_f64(actual.unit_vector[2], unit_vector[2])
                && same_f64(actual.magnitude, magnitude),
            "{body:?} at JD {jd:?}: {actual:?}"
        );
    }
}

#[test]
fn planet_positions_over_two_centuries() {
    let bodies = [
        Body::Sun,
        Body::Mercury,
        Body::Venus,
        Body::Earth,
        Body::Moon,
        Body::Mars,
        Body::Jupiter,
        Body::Saturn,
        Body::Uranus,
        Body::Neptune,
    ];
    let mut digest = Digest::new();
    for step in 0..40 {
        // Every five years and a bit from 1900, at a different hour each time.
        let jd = 2_415_020.5 + f64::from(step) * 1_826.262_5 + f64::from(step % 7) * 0.137;
        for body in bodies {
            let p = position(body, jd);
            digest.f64(p.ra_radians);
            digest.f64(p.dec_radians);
            p.unit_vector.iter().for_each(|&c| digest.f64(c));
            digest.f64(p.magnitude);
        }
        let batch = all_positions(jd);
        let order: Vec<Body> = batch.iter().map(|p| p.body).collect();
        assert_eq!(
            order,
            [
                Body::Sun,
                Body::Mercury,
                Body::Venus,
                Body::Moon,
                Body::Mars,
                Body::Jupiter,
                Body::Saturn,
                Body::Uranus,
                Body::Neptune,
            ]
        );
        for p in batch {
            let single = position(p.body, jd);
            assert!(same_f64(p.ra_radians, single.ra_radians));
            assert!(same_f64(p.dec_radians, single.dec_radians));
            assert_eq!(
                p.unit_vector.map(f64::to_bits),
                single.unit_vector.map(f64::to_bits)
            );
            assert!(same_f64(p.magnitude, single.magnitude));
        }
    }
    assert_eq!(
        digest.0, 0xec95_27e9_cf18_8201,
        "planet digest moved: {:#018x}",
        digest.0
    );
}

#[test]
fn body_colors() {
    let colors = [
        Body::Sun,
        Body::Mercury,
        Body::Venus,
        Body::Earth,
        Body::Moon,
        Body::Mars,
        Body::Jupiter,
        Body::Saturn,
        Body::Uranus,
        Body::Neptune,
    ]
    .map(body_color);
    assert_eq!(
        colors,
        [
            (255, 214, 102),
            (180, 180, 170),
            (244, 230, 190),
            (100, 149, 237),
            (214, 214, 214),
            (219, 98, 71),
            (216, 180, 140),
            (210, 195, 142),
            (142, 212, 220),
            (92, 126, 220),
        ]
    );
}

#[test]
fn stereo_projection_sweep() {
    let observers = [
        (55.75, 37.62, DateTime::new(2024, 6, 14, 6, 10, 0)),
        (-33.9, 18.4, DateTime::new(2000, 1, 1, 12, 0, 0)),
        (90.0, 0.0, DateTime::new(2024, 1, 1, 0, 0, 0)),
        (0.0, -120.0, DateTime::new(1999, 12, 31, 23, 59, 59)),
    ];
    let points = sweep_points();
    let mut digest = Digest::new();
    let mut visible = 0;
    for (latitude, longitude, at) in observers {
        for &(x, y, z) in &points {
            match StereoProjection::project(x, y, z, latitude, longitude, at) {
                Some(p) => {
                    visible += 1;
                    digest.some();
                    for value in [p.x, p.y, p.radius, p.angle, p.zenith] {
                        digest.f32(value);
                    }
                }
                None => digest.none(),
            }
        }
    }
    assert_eq!(
        (points.len(), visible),
        (926, 1934),
        "points swept and points seen"
    );
    assert_eq!(
        digest.0, 0xe27b_1aa4_0f51_c2ce,
        "stereo digest moved: {:#018x}",
        digest.0
    );

    // Vega over Moscow on the backend's default date.
    let vega = (0.125_096_47, -0.769_413_1, 0.626_381_93);
    let p = StereoProjection::project(
        vega.0,
        vega.1,
        vega.2,
        55.75,
        37.62,
        DateTime::new(2024, 6, 14, 6, 10, 0),
    )
    .expect("Vega is up");
    let pinned: [f32; 5] = [-0.24660607, 0.93404615, 0.9660522, 1.8289254, 0.899953];
    let actual = [p.x, p.y, p.radius, p.angle, p.zenith];
    assert_eq!(
        actual.map(f32::to_bits),
        pinned.map(f32::to_bits),
        "Vega: {actual:?}"
    );
}

#[test]
fn camera_configs() {
    /// (fov, aspect, height) and the (width, height, focal length) they give.
    type Pin = ((f64, f64, u32), (u32, u32, f64));
    const PINNED: [Pin; 4] = [
        ((60.0, 1.5, 800), (1200, 800, 1248.99959967968)),
        ((30.0, 1.0, 600), (600, 600, 1583.3750602588107)),
        ((90.0, 16.0 / 9.0, 1080), (1920, 1080, 1101.4535850411494)),
        ((120.0, 0.75, 1001), (750, 1001, 361.0748998938218)),
    ];
    for ((fov, aspect, height), (width, pinned_height, focal)) in PINNED {
        let camera = CameraConfig::from_fov_and_aspect(fov, aspect, height);
        assert!(
            camera.width == width
                && camera.height == pinned_height
                && same_f64(camera.focal_length, focal),
            "from_fov_and_aspect({fov}, {aspect}, {height}) = {camera:?}"
        );
    }
    let camera = CameraConfig::new(640, 480, 512.5);
    assert_eq!((camera.width, camera.height), (640, 480));
    assert!(same_f64(camera.focal_length, 512.5));
}

#[test]
fn pinhole_projection_sweep() {
    let cameras = [
        CameraConfig::from_fov_and_aspect(60.0, 1.5, 800),
        CameraConfig::from_fov_and_aspect(30.0, 1.0, 600),
        CameraConfig::from_fov_and_aspect(90.0, 16.0 / 9.0, 1080),
        CameraConfig::new(640, 480, 512.5),
    ];
    let directions = [
        [1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, -1.0],
        [0.3, -0.5, 0.8],
        [-0.2, 0.9, 0.1],
        [0.0, 0.0, 0.0],
    ];
    let tilts = [0.0, 33.0, -90.0];
    let points = sweep_points();
    let mut digest = Digest::new();
    let mut visible = 0;
    for camera in &cameras {
        digest.u32(camera.width);
        digest.u32(camera.height);
        digest.f64(camera.focal_length);
        for direction in directions {
            for tilt in tilts {
                for &(x, y, z) in &points {
                    match PinholeProjection::project(x, y, z, direction, tilt, camera) {
                        Some(p) => {
                            visible += 1;
                            digest.some();
                            digest.f32(p.x_pix);
                            digest.f32(p.y_pix);
                        }
                        None => digest.none(),
                    }
                }
            }
        }
    }
    assert_eq!(visible, 3717, "points seen");
    assert_eq!(
        digest.0, 0x17f5_26e6_513a_c294,
        "pinhole digest moved: {:#018x}",
        digest.0
    );

    // Betelgeuse in a 60° frame on Orion, tilted.
    let camera = CameraConfig::from_fov_and_aspect(60.0, 1.5, 800);
    let p = PinholeProjection::project(
        0.020_889_85,
        0.991_435_2,
        0.128_917_84,
        [0.08, 0.99, 0.05],
        12.5,
        &camera,
    )
    .expect("Betelgeuse is in the frame");
    assert_eq!(
        [p.x_pix, p.y_pix].map(f32::to_bits),
        [549.1191f32, 287.177].map(f32::to_bits),
        "Betelgeuse: {p:?}"
    );
}

#[test]
fn view_projection_sweep() {
    let tilted = |a: f64| {
        let (s, c) = a.to_radians().sin_cos();
        (
            [c, s, 0.0],
            [-s * 0.6, c * 0.6, 0.8],
            [s * 0.8, -c * 0.8, 0.6],
        )
    };
    let (right, up, forward) = tilted(37.0);
    let views = [
        (
            ViewKind::Stereo,
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            180.0,
            1000.0,
            1000.0,
        ),
        (ViewKind::Stereo, right, up, forward, 90.0, 1600.0, 900.0),
        (
            ViewKind::Stereo,
            [-1.0, 0.0, 0.0],
            [0.0, 0.0, 2.0],
            [0.0, -3.0, 0.0],
            300.0,
            640.0,
            1280.0,
        ),
        (ViewKind::Pinhole, right, up, forward, 60.0, 1200.0, 800.0),
        (
            ViewKind::Pinhole,
            [-1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            120.0,
            800.0,
            1200.0,
        ),
        (
            ViewKind::Pinhole,
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
            10.5,
            333.0,
            777.0,
        ),
    ];
    let points = sweep_points();
    let mut digest = Digest::new();
    let mut visible = 0;
    for (kind, right, up, forward, fov, width, height) in views {
        let view = ViewProjection::new(kind, right, up, forward, fov, width, height)
            .expect("a valid view");
        assert_eq!(view.kind(), kind);
        digest.f64(view.width());
        digest.f64(view.height());
        let (half_w, half_h) = view.half_extent();
        digest.f64(half_w);
        digest.f64(half_h);
        for &(x, y, z) in &points {
            match view.normalized(f64::from(x), f64::from(y), f64::from(z)) {
                Some((nx, ny)) => {
                    digest.some();
                    digest.f64(nx);
                    digest.f64(ny);
                }
                None => digest.none(),
            }
            match view.project(x, y, z) {
                Some((px, py)) => {
                    visible += 1;
                    digest.some();
                    digest.f32(px);
                    digest.f32(py);
                    let touches = view.touches_chart(px, py, 3.5);
                    digest.bytes(&[u8::from(touches)]);
                }
                None => digest.none(),
            }
        }
        for step in -10..=10 {
            let offset = step as f32 * 0.07;
            let (px, py) = (
                width as f32 * (0.5 + offset),
                height as f32 * (0.5 - offset * 1.3),
            );
            for radius in [0.0, 2.0, 40.0] {
                digest.bytes(&[u8::from(view.touches_chart(px, py, radius))]);
            }
        }
    }
    assert_eq!(visible, 3145, "points seen");
    assert_eq!(
        digest.0, 0x02df_e20e_3b24_03d3,
        "view digest moved: {:#018x}",
        digest.0
    );

    let rejected = [
        (
            ViewKind::Stereo,
            [0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            90.0,
            10.0,
            10.0,
        ),
        (
            ViewKind::Stereo,
            [1.0, 0.0, 0.0],
            [0.0, f64::NAN, 0.0],
            [0.0, 0.0, 1.0],
            90.0,
            10.0,
            10.0,
        ),
        (
            ViewKind::Pinhole,
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            180.0,
            10.0,
            10.0,
        ),
        (
            ViewKind::Stereo,
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            360.0,
            10.0,
            10.0,
        ),
        (
            ViewKind::Stereo,
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            0.0,
            10.0,
            10.0,
        ),
        (
            ViewKind::Stereo,
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            90.0,
            0.0,
            10.0,
        ),
        (
            ViewKind::Pinhole,
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            90.0,
            10.0,
            f64::INFINITY,
        ),
    ];
    for (kind, right, up, forward, fov, width, height) in rejected {
        assert!(
            ViewProjection::new(kind, right, up, forward, fov, width, height).is_none(),
            "{kind:?} {right:?} {up:?} {forward:?} {fov} {width}x{height} should not make a view"
        );
    }
}

#[test]
fn hipparcos_catalogue() {
    let catalog = HipCatalog::new();
    let all = catalog.get_stars(f32::INFINITY, None);
    let mut digest = Digest::new();
    for star in &all {
        digest.i32(star.hip_id);
        for value in [star.v_mag, star.ra, star.dec, star.x, star.y, star.z] {
            digest.f32(value);
        }
    }
    assert_eq!(all.len(), 8870);
    assert_eq!(
        digest.0, 0x0659_a578_ffd5_89cc,
        "catalogue digest moved: {:#018x}",
        digest.0
    );

    let counts = [
        catalog.get_stars(4.0, None).len(),
        catalog.get_stars(6.5, None).len(),
        catalog.get_stars(6.5, Some(3.0)).len(),
        // Both bounds are inclusive: Polaris is 1.97.
        catalog.get_stars(1.97, Some(1.97)).len(),
        catalog.get_stars(-2.0, None).len(),
        catalog.iter_stars(4.0, Some(1.0)).count(),
        catalog.iter_stars(f32::NAN, None).count(),
    ];
    assert_eq!(counts, [518, 8870, 8698, 1, 0, 503, 0]);

    let polaris = catalog
        .iter_stars(2.0, Some(1.9))
        .find(|star| star.hip_id == 11767)
        .expect("Polaris is in the catalogue");
    assert_eq!(
        [
            polaris.v_mag,
            polaris.ra,
            polaris.dec,
            polaris.x,
            polaris.y,
            polaris.z
        ]
        .map(f32::to_bits),
        [
            1.97f32,
            0.662_431_24,
            1.557_952_6,
            0.010_126_979,
            0.007_899_124,
            0.999_917_5
        ]
        .map(f32::to_bits)
    );
}

#[test]
fn messier_catalogue() {
    let catalog = MessierCatalog::new();
    let all = catalog.get_all_objects();
    let mut digest = Digest::new();
    for object in &all {
        digest.i32(object.m_number);
        digest.str(&object.name);
        for value in [
            object.ra,
            object.dec,
            object.x,
            object.y,
            object.z,
            object.v_mag,
            object.size,
        ] {
            digest.f32(value);
        }
        digest.i32(object.obj_type);
        digest.str(&object.constellation);
        digest.str(object.type_name());
        digest.str(object.type_color());
    }
    assert_eq!(all.len(), 110);
    assert_eq!(
        digest.0, 0x7699_7424_68b3_e364,
        "Messier digest moved: {:#018x}",
        digest.0
    );
    assert_eq!(
        all.iter().map(|o| o.m_number).collect::<Vec<_>>(),
        (1..=110).collect::<Vec<_>>()
    );

    let m42 = catalog.get_object_by_number(42).expect("M42 exists");
    assert_eq!(m42.name, "Orion Nebula");
    assert_eq!(m42.constellation, "Ori");
    assert_eq!(
        (m42.obj_type, m42.type_name(), m42.type_color()),
        (4, "Nebula", "#00CED1")
    );
    assert_eq!(
        [m42.ra, m42.dec, m42.x, m42.y, m42.z, m42.v_mag, m42.size].map(f32::to_bits),
        [
            1.462_971_3f32,
            -0.094_092_64,
            0.107_140_14,
            0.989_794_73,
            -0.093_953_86,
            4.0,
            85.0
        ]
        .map(f32::to_bits)
    );
    assert!(catalog.get_object_by_number(0).is_none());
    assert!(catalog.get_object_by_number(111).is_none());

    let kinds: Vec<(usize, &str, &str)> = (1..=7)
        .map(|kind| {
            let objects = catalog.get_objects_by_type(kind);
            assert_eq!(objects.len(), catalog.iter_objects_by_type(kind).count());
            (
                objects.len(),
                objects[0].type_name(),
                objects[0].type_color(),
            )
        })
        .collect();
    assert_eq!(
        kinds,
        [
            (40, "Galaxy", "#FF6B9D"),
            (29, "Globular Cluster", "#FFD700"),
            (27, "Open Cluster", "#87CEEB"),
            (11, "Nebula", "#00CED1"),
            (1, "Supernova Remnant", "#FF4500"),
            (1, "Star Cloud", "#DDA0DD"),
            (1, "Double Star", "#FFFDE7"),
        ]
    );
    assert!(catalog.get_objects_by_type(0).is_empty());
    assert!(catalog.get_objects_by_type(8).is_empty());

    let by_constellation = [
        catalog.get_objects_by_constellation("Sgr").len(),
        catalog.get_objects_by_constellation("vir").len(),
        catalog.iter_objects_by_constellation("UMA").count(),
        catalog.get_objects_by_constellation("Xyz").len(),
    ];
    assert_eq!(by_constellation, [15, 11, 7, 0]);
    let by_magnitude = [
        catalog.get_objects_by_magnitude(0.0, 6.0).len(),
        catalog.get_objects_by_magnitude(8.0, 9.0).len(),
        catalog.iter_objects_by_magnitude(9.0, 8.0).count(),
    ];
    assert_eq!(by_magnitude, [28, 25, 0]);
}
