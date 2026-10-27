//! The generator preview's camera, so an export can show exactly what the preview shows.
//!
//! The SvelteKit preview turns the sky with a free rotation and projects it in view
//! space, whose axes are the screen's `right` and `up` and the chart centre,
//! `forward`. The export receives that basis in the equatorial frame and projects
//! with the same formulas. The other copy of them is
//! `frontend/src/lib/math/projection.ts` (`getProjectionFrameParams` and
//! `sampleStarMorphFrame`); both are pinned to
//! `backend/assets/golden/view-projection.json`.
//!
//! The basis is taken as given, `right` included, so whichever way round the
//! preview draws the sky (east left or east right), the export follows it.

/// Below this the projection divides by (nearly) zero: the point is behind the camera.
const FINITE_EPSILON: f64 = 1e-4;

/// Points further out than this many chart half-sizes do not project. Lines break
/// there instead of running off towards infinity; the chart itself spans -1..1.
const NORM_LIMIT: f64 = 4.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewKind {
    /// Stereographic disc, as wide as the shorter side of the chart.
    Stereo,
    /// Pinhole (gnomonic) frame filling the chart.
    Pinhole,
}

#[derive(Debug, Clone, Copy)]
pub struct ViewProjection {
    kind: ViewKind,
    right: [f64; 3],
    up: [f64; 3],
    forward: [f64; 3],
    width: f64,
    height: f64,
    /// Stereo: 1 / tan(fov/4). Pinhole: 1 / tan(hfov/2).
    scale_x: f64,
    /// Stereo: as `scale_x`. Pinhole: 1 / tan(vfov/2), the vertical fov following the aspect.
    scale_y: f64,
}

impl ViewProjection {
    /// `fov_deg` is the field of view across the disc for `Stereo` (180° shows a
    /// hemisphere) and the horizontal one for `Pinhole`. `width` and `height` are the
    /// chart size in px. Returns `None` for a degenerate basis vector, a size that is
    /// not positive or a field of view the projection cannot show.
    pub fn new(
        kind: ViewKind,
        right: [f64; 3],
        up: [f64; 3],
        forward: [f64; 3],
        fov_deg: f64,
        width: f64,
        height: f64,
    ) -> Option<Self> {
        let right = normalize(right)?;
        let up = normalize(up)?;
        let forward = normalize(forward)?;
        if !(width > 0.0 && height > 0.0 && width.is_finite() && height.is_finite()) {
            return None;
        }
        let max_fov = match kind {
            ViewKind::Stereo => 360.0,
            ViewKind::Pinhole => 180.0,
        };
        if !(fov_deg > 0.0 && fov_deg < max_fov) {
            return None;
        }
        let (scale_x, scale_y) = match kind {
            ViewKind::Stereo => {
                let scale = 1.0 / (fov_deg.to_radians() * 0.25).tan();
                (scale, scale)
            }
            ViewKind::Pinhole => {
                let tan_half_h = (fov_deg.to_radians() * 0.5).tan();
                let tan_half_v = tan_half_h / (width / height);
                (1.0 / tan_half_h, 1.0 / tan_half_v)
            }
        };
        Some(Self {
            kind,
            right,
            up,
            forward,
            width,
            height,
            scale_x,
            scale_y,
        })
    }

    pub fn kind(&self) -> ViewKind {
        self.kind
    }

    pub fn width(&self) -> f64 {
        self.width
    }

    pub fn height(&self) -> f64 {
        self.height
    }

    /// Half-sizes of the chart in px: the disc radius twice for `Stereo`.
    pub fn half_extent(&self) -> (f64, f64) {
        match self.kind {
            ViewKind::Stereo => {
                let radius = self.width.min(self.height) * 0.5;
                (radius, radius)
            }
            ViewKind::Pinhole => (self.width * 0.5, self.height * 0.5),
        }
    }

    /// Chart-normalised position, y up: the chart edge is at 1 (the disc's radius
    /// for `Stereo`, either side of the frame for `Pinhole`).
    pub fn normalized(&self, x: f64, y: f64, z: f64) -> Option<(f64, f64)> {
        let point = [x, y, z];
        let vx = dot(self.right, point);
        let vy = dot(self.up, point);
        let vz = dot(self.forward, point);
        let denom = match self.kind {
            ViewKind::Stereo => 1.0 + vz,
            ViewKind::Pinhole => vz,
        };
        if denom <= FINITE_EPSILON {
            return None;
        }
        let nx = vx / denom * self.scale_x;
        let ny = vy / denom * self.scale_y;
        if nx.abs() > NORM_LIMIT || ny.abs() > NORM_LIMIT {
            return None;
        }
        Some((nx, ny))
    }

    /// Position in px, origin top-left, y down.
    pub fn project(&self, x: f32, y: f32, z: f32) -> Option<(f32, f32)> {
        let (nx, ny) = self.normalized(x as f64, y as f64, z as f64)?;
        let (half_w, half_h) = self.half_extent();
        Some((
            (self.width * 0.5 + nx * half_w) as f32,
            (self.height * 0.5 - ny * half_h) as f32,
        ))
    }

    /// Whether a disc of `radius` px at `(px, py)` reaches into the chart.
    pub fn touches_chart(&self, px: f32, py: f32, radius: f32) -> bool {
        let (px, py, radius) = (px as f64, py as f64, radius as f64);
        let dx = px - self.width * 0.5;
        let dy = py - self.height * 0.5;
        let (half_w, half_h) = self.half_extent();
        match self.kind {
            ViewKind::Stereo => dx.hypot(dy) <= half_w + radius,
            ViewKind::Pinhole => dx.abs() <= half_w + radius && dy.abs() <= half_h + radius,
        }
    }
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn normalize(v: [f64; 3]) -> Option<[f64; 3]> {
    let norm = dot(v, v).sqrt();
    if !norm.is_finite() || norm < 1e-6 {
        return None;
    }
    Some([v[0] / norm, v[1] / norm, v[2] / norm])
}

#[cfg(test)]
mod tests {
    use super::*;

    const RIGHT: [f64; 3] = [1.0, 0.0, 0.0];
    const UP: [f64; 3] = [0.0, 1.0, 0.0];
    const FORWARD: [f64; 3] = [0.0, 0.0, 1.0];

    fn unit_at(angle_deg: f64, towards: [f64; 3]) -> (f32, f32, f32) {
        let a = angle_deg.to_radians();
        (
            (towards[0] * a.sin() + FORWARD[0] * a.cos()) as f32,
            (towards[1] * a.sin() + FORWARD[1] * a.cos()) as f32,
            (towards[2] * a.sin() + FORWARD[2] * a.cos()) as f32,
        )
    }

    #[test]
    fn stereo_puts_the_fov_edge_on_the_disc_edge() {
        let view = ViewProjection::new(ViewKind::Stereo, RIGHT, UP, FORWARD, 120.0, 1000.0, 1000.0)
            .unwrap();
        let (x, y, z) = unit_at(0.0, RIGHT);
        assert_eq!(view.project(x, y, z), Some((500.0, 500.0)));
        let (x, y, z) = unit_at(60.0, RIGHT);
        let (px, py) = view.project(x, y, z).unwrap();
        assert!((px - 1000.0).abs() < 1e-3 && (py - 500.0).abs() < 1e-3);
        let (x, y, z) = unit_at(60.0, UP);
        let (px, py) = view.project(x, y, z).unwrap();
        assert!(
            (px - 500.0).abs() < 1e-3 && py.abs() < 1e-3,
            "up is towards y = 0"
        );
    }

    #[test]
    fn pinhole_fov_is_horizontal_and_the_vertical_follows_the_aspect() {
        let view = ViewProjection::new(ViewKind::Pinhole, RIGHT, UP, FORWARD, 90.0, 1600.0, 900.0)
            .unwrap();
        let (x, y, z) = unit_at(45.0, RIGHT);
        let (px, _) = view.project(x, y, z).unwrap();
        assert!((px - 1600.0).abs() < 1e-2);
        // tan(vfov/2) = tan(45°) · 9/16.
        let vertical = (9.0f64 / 16.0).atan().to_degrees();
        let (x, y, z) = unit_at(vertical, UP);
        let (_, py) = view.project(x, y, z).unwrap();
        assert!(py.abs() < 1e-2);
    }

    #[test]
    fn the_basis_carries_the_handedness() {
        let mirrored = [-1.0, 0.0, 0.0];
        let view = ViewProjection::new(
            ViewKind::Pinhole,
            mirrored,
            UP,
            FORWARD,
            90.0,
            1000.0,
            1000.0,
        )
        .unwrap();
        let (x, y, z) = unit_at(20.0, RIGHT);
        let (px, _) = view.project(x, y, z).unwrap();
        assert!(px < 500.0);
    }

    #[test]
    fn points_behind_or_far_off_the_chart_do_not_project() {
        let pinhole =
            ViewProjection::new(ViewKind::Pinhole, RIGHT, UP, FORWARD, 60.0, 1000.0, 1000.0)
                .unwrap();
        assert_eq!(pinhole.project(0.0, 0.0, -1.0), None);
        let (x, y, z) = unit_at(89.0, RIGHT);
        assert_eq!(pinhole.project(x, y, z), None);
        let stereo =
            ViewProjection::new(ViewKind::Stereo, RIGHT, UP, FORWARD, 180.0, 1000.0, 1000.0)
                .unwrap();
        assert_eq!(stereo.project(0.0, 0.0, -1.0), None);
    }

    #[test]
    fn rejects_a_degenerate_view() {
        let zero = [0.0, 0.0, 0.0];
        assert!(
            ViewProjection::new(ViewKind::Stereo, zero, UP, FORWARD, 90.0, 10.0, 10.0).is_none()
        );
        assert!(
            ViewProjection::new(ViewKind::Pinhole, RIGHT, UP, FORWARD, 180.0, 10.0, 10.0).is_none()
        );
        assert!(
            ViewProjection::new(ViewKind::Stereo, RIGHT, UP, FORWARD, 90.0, 0.0, 10.0).is_none()
        );
    }
}
