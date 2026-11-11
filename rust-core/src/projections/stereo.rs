//! The observer's stereographic sky: the horizon system of a place and an instant,
//! projected from the nadir onto the plane of the horizon.

use serde::{Deserialize, Serialize};

use crate::time::{DateTime, vernal_equinox_hour_angle};

/// Points further than this from the zenith, about 94.7°, do not project: a little
/// below the horizon still shows, the rest of the lower sky does not.
const MAX_ZENITH: f64 = std::f64::consts::PI / 1.9;

/// A point of the stereographic sky.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct StereoPoint {
    /// Position on the plane of the horizon towards the south point, in units of
    /// the sphere's radius (the horizon is the circle of radius 2):
    /// `radius · cos(angle)`.
    pub x: f32,
    /// Position towards the west point, `radius · sin(angle)`.
    pub y: f32,
    /// Distance from the zenith on the plane, `2 · tan(zenith / 2)`.
    pub radius: f32,
    /// Azimuth in radians, from the south point towards the west.
    pub angle: f32,
    /// Zenith distance, radians.
    pub zenith: f32,
}

/// The stereographic projection of the sky of an observer at a place and instant.
#[derive(Debug, Clone, Copy)]
pub struct StereoProjection {
    sin_latitude: f64,
    cos_latitude: f64,
    sin_sidereal: f64,
    cos_sidereal: f64,
}

impl StereoProjection {
    /// The sky over geographic `latitude_deg` and `longitude_deg` at `date_time` (UT).
    ///
    /// The longitude does not turn the sky (see [`crate::time::sidereal_time`]).
    #[must_use]
    pub fn new(latitude_deg: f32, longitude_deg: f32, date_time: DateTime) -> Self {
        let lat = f64::from(latitude_deg).to_radians();
        let lon = f64::from(longitude_deg).to_radians();

        // Рассчитываем звездное время
        let sidereal_time = vernal_equinox_hour_angle(lon, date_time);

        // Коэффициенты матрицы поворота
        Self {
            sin_latitude: lat.sin(),
            cos_latitude: lat.cos(),
            sin_sidereal: sidereal_time.sin(),
            cos_sidereal: sidereal_time.cos(),
        }
    }

    /// Projects a direction given in the equatorial frame (`x` to RA 0h, `z` to the
    /// north celestial pole). `None` for a point more than about 94.7° from the zenith.
    #[must_use]
    pub fn project(&self, x: f32, y: f32, z: f32) -> Option<StereoPoint> {
        let (sl, cl) = (self.sin_latitude, self.cos_latitude);
        let (st, ct) = (self.sin_sidereal, self.cos_sidereal);

        // Умножение матрицы поворота на ECI координаты звезды (star_x, star_y, star_z)
        let x = f64::from(x);
        let y = f64::from(y);
        let z = f64::from(z);

        // Новые координаты в горизонтальной декартовой системе
        let x_hor = st * x - ct * y;
        let y_hor = sl * ct * x + sl * st * y - cl * z;
        let z_hor = cl * ct * x + cl * st * y + sl * z;

        // Зенитное расстояние
        // Ограничиваем z_hor в диапазоне [-1.0, 1.0], чтобы избежать NaN в acos
        let z_hor_clamped = z_hor.clamp(-1.0, 1.0);
        let zenith = z_hor_clamped.acos();

        // Проверка видимости: зенитное расстояние не должно превышать pi / 1.9 (~94.7 градусов)
        if zenith > MAX_ZENITH {
            return None;
        }

        // Азимут
        let azimuth = x_hor.atan2(y_hor);

        // Радиус стереографической проекции
        let radius = 2.0 * (zenith / 2.0).tan();
        let angle = azimuth;

        // Декартовы координаты на плоскости проекции
        let x_proj = radius * angle.cos();
        let y_proj = radius * angle.sin();

        Some(StereoPoint {
            x: x_proj as f32,
            y: y_proj as f32,
            radius: radius as f32,
            angle: angle as f32,
            zenith: zenith as f32,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stereo_projection() {
        // Полярная звезда имеет dec близкую к 90 градусам.
        // При наблюдении с Северного полюса (latitude = 90.0) в зените (zenith = 0.0),
        // она должна проецироваться близко к центру (0.0, 0.0).
        let dt = DateTime::new(2024, 1, 1, 0, 0, 0);

        // Примерная звезда рядом с Северным полюсом мира (ra=0, dec=89)
        // ECI: x = cos(89)*cos(0), y = cos(89)*sin(0), z = sin(89)
        let dec_rad = 89.0f32.to_radians();
        let star_x = dec_rad.cos();
        let star_y = 0.0;
        let star_z = dec_rad.sin();

        // Наблюдатель на Северном Полюсе
        let north_pole = StereoProjection::new(90.0, 0.0, dt);
        let proj = north_pole.project(star_x, star_y, star_z);

        assert!(proj.is_some());
        let res = proj.unwrap();
        // Зенит должен быть около 1 градуса (90 - 89) = 0.0175 рад
        assert!((res.zenith - 1.0f32.to_radians()).abs() < 1e-4);
        assert!(res.radius > 0.0);
        // Координаты на плоскости должны быть очень близки к центру
        assert!(res.x.abs() < 0.1);
        assert!(res.y.abs() < 0.1);

        // Звезда сзади наблюдателя (на Южном полюсе) при наблюдении с Севера
        let proj_invisible = north_pole.project(0.0, 0.0, -1.0);
        // Должно быть отфильтровано ограничением zenith > pi / 1.9
        assert!(proj_invisible.is_none());
    }
}
