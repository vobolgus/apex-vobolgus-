use crate::models::RenderConfig;

pub(super) fn draw_coordinate_grids<F>(
    svg: &mut String,
    config: &RenderConfig,
    grid_color: &str,
    project_point: &F,
) where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    if config.layers.equatorial_grid {
        draw_equatorial_grid(svg, grid_color, project_point);
    }

    if config.layers.equator {
        draw_celestial_equator(svg, grid_color, project_point);
    }

    if config.layers.ecliptic {
        draw_ecliptic(svg, project_point);
    }
}

pub(super) fn draw_equatorial_grid<F>(svg: &mut String, grid_color: &str, project_point: &F)
where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    let decs = [
        -75.0f32, -60.0, -45.0, -30.0, -15.0, 0.0, 15.0, 30.0, 45.0, 60.0, 75.0,
    ];
    for &dec_deg in &decs {
        let dec_rad = dec_deg.to_radians();
        let cos_d = dec_rad.cos();
        let sin_d = dec_rad.sin();
        let mut path = String::with_capacity(4096);
        let mut first = true;

        for i in 0..=72 {
            let ra_deg = (i as f32) * 5.0;
            let ra_rad = ra_deg.to_radians();
            let x = cos_d * ra_rad.cos();
            let y = cos_d * ra_rad.sin();
            let z = sin_d;

            if let Some((px, py)) = project_point(x, y, z) {
                if first {
                    path.push_str(&format!("M {} {}", px, py));
                    first = false;
                } else {
                    path.push_str(&format!(" L {} {}", px, py));
                }
            } else {
                first = true;
            }
        }
        if !path.is_empty() {
            svg.push_str(&format!(
                r##"<path d="{}" fill="none" stroke="{}" stroke-width="0.5" opacity="0.25" />"##,
                path, grid_color
            ));
        }
    }

    for h in 0..24 {
        let ra_deg = (h as f32) * 15.0;
        let ra_rad = ra_deg.to_radians();
        let cos_r = ra_rad.cos();
        let sin_r = ra_rad.sin();
        let mut path = String::with_capacity(4096);
        let mut first = true;

        for i in 0..=36 {
            let dec_deg = -90.0 + (i as f32) * 5.0;
            let dec_rad = dec_deg.to_radians();
            let x = dec_rad.cos() * cos_r;
            let y = dec_rad.cos() * sin_r;
            let z = dec_rad.sin();

            if let Some((px, py)) = project_point(x, y, z) {
                if first {
                    path.push_str(&format!("M {} {}", px, py));
                    first = false;
                } else {
                    path.push_str(&format!(" L {} {}", px, py));
                }
            } else {
                first = true;
            }
        }
        if !path.is_empty() {
            svg.push_str(&format!(
                r##"<path d="{}" fill="none" stroke="{}" stroke-width="0.5" opacity="0.25" />"##,
                path, grid_color
            ));
        }
    }
}

pub(super) fn draw_celestial_equator<F>(svg: &mut String, grid_color: &str, project_point: &F)
where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    let mut path = String::with_capacity(4096);
    let mut first = true;
    for i in 0..=72 {
        let ra_deg = (i as f32) * 5.0;
        let ra_rad = ra_deg.to_radians();
        let x = ra_rad.cos();
        let y = ra_rad.sin();
        let z = 0.0;

        if let Some((px, py)) = project_point(x, y, z) {
            if first {
                path.push_str(&format!("M {} {}", px, py));
                first = false;
            } else {
                path.push_str(&format!(" L {} {}", px, py));
            }
        } else {
            first = true;
        }
    }
    if !path.is_empty() {
        svg.push_str(&format!(
            r##"<path d="{}" fill="none" stroke="{}" stroke-width="1.0" opacity="0.45" />"##,
            path, grid_color
        ));
    }
}

pub(super) fn draw_ecliptic<F>(svg: &mut String, project_point: &F)
where
    F: Fn(f32, f32, f32) -> Option<(f32, f32)>,
{
    let epsilon = 23.439_291_f32.to_radians();
    let cos_eps = epsilon.cos();
    let sin_eps = epsilon.sin();
    let mut path = String::with_capacity(4096);
    let mut first = true;

    for i in 0..=72 {
        let lambda = (i as f32 * 5.0).to_radians();
        let x = lambda.cos();
        let y = lambda.sin() * cos_eps;
        let z = lambda.sin() * sin_eps;

        if let Some((px, py)) = project_point(x, y, z) {
            if first {
                path.push_str(&format!("M {} {}", px, py));
                first = false;
            } else {
                path.push_str(&format!(" L {} {}", px, py));
            }
        } else {
            first = true;
        }
    }
    if !path.is_empty() {
        svg.push_str(&format!(
            r##"<path d="{}" fill="none" stroke="#FFD700" stroke-width="1.0" stroke-dasharray="4,4" opacity="0.6" />"##,
            path,
        ));
    }
}
