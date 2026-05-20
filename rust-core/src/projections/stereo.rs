use crate::time::{vequinox_hour_angle, DateTime};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct StereoProjectionResult {
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub angle: f32,
    pub zenith: f32,
}

pub struct StereoProjection;

impl StereoProjection {
    /// Проецирует ECI координаты (x,y,z) звезды в стереографическую проекцию
    /// относительно местоположения наблюдателя (latitude_deg, longitude_deg) и времени date_time.
    /// Возвращает None, если звезда находится за пределами видимости (zenith > pi/1.9).
    pub fn project(
        star_x: f32,
        star_y: f32,
        star_z: f32,
        latitude_deg: f32,
        longitude_deg: f32,
        date_time: DateTime,
    ) -> Option<StereoProjectionResult> {
        let lat = (latitude_deg as f64).to_radians();
        let lon = (longitude_deg as f64).to_radians();

        // Рассчитываем звездное время
        let sidereal_time = vequinox_hour_angle(lon, date_time);

        // Коэффициенты матрицы поворота
        let sl = lat.sin();
        let cl = lat.cos();
        let st = sidereal_time.sin();
        let ct = sidereal_time.cos();

        // Умножение матрицы поворота на ECI координаты звезды (star_x, star_y, star_z)
        let x = star_x as f64;
        let y = star_y as f64;
        let z = star_z as f64;

        // Новые координаты в горизонтальной декартовой системе
        let x_hor = st * x - ct * y;
        let y_hor = sl * ct * x + sl * st * y - cl * z;
        let z_hor = cl * ct * x + cl * st * y + sl * z;

        // Зенитное расстояние
        // Ограничиваем z_hor в диапазоне [-1.0, 1.0], чтобы избежать NaN в acos
        let z_hor_clamped = z_hor.clamp(-1.0, 1.0);
        let zenith = z_hor_clamped.acos();

        // Проверка видимости: зенитное расстояние не должно превышать pi / 1.9 (~94.7 градусов)
        let max_zenith = std::f64::consts::PI / 1.9;
        if zenith > max_zenith {
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

        Some(StereoProjectionResult {
            x: x_proj as f32,
            y: y_proj as f32,
            radius: radius as f32,
            angle: angle as f32,
            zenith: zenith as f32,
        })
    }
}
