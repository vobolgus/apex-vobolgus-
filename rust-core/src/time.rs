use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DateTime {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

impl DateTime {
    pub fn new(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> Self {
        Self {
            year,
            month,
            day,
            hour,
            minute,
            second,
        }
    }
}

pub fn julian_date(year: i32, month: u32, day: u32) -> f64 {
    let (y, m) = if month > 2 {
        (year, month as i32)
    } else {
        (year - 1, month as i32 + 12)
    };

    let d = day as f64;

    let b =
        if year < 1582 || (year == 1582 && month < 10) || (year == 1582 && month == 10 && day <= 4)
        {
            0.0
        } else {
            let a = (y as f64 / 100.0).floor();
            2.0 - a + (a / 4.0).floor()
        };

    (365.25 * y as f64).floor() + (30.6001 * (m + 1) as f64).floor() + d + b + 1720994.5
}

pub fn get_sidereal_time(_longitude: f64, date_time: DateTime) -> f64 {
    // Параметр longitude объявлен, но пока не используется.
    // Мы повторяем это поведение для 100% математической идентичности.

    // jd на 0 January (31 декабря предыдущего года)
    let jd_origin = julian_date(date_time.year - 1, 12, 31);

    // jd на текущий день
    let jd_current = julian_date(date_time.year, date_time.month, date_time.day);

    // Количество дней с 0 January
    let shift = (jd_current - jd_origin).round() as i32;

    let t = (jd_origin - 2415020.0) / 36525.0;
    let r = 6.6460656 + 2400.051262 * t + 0.00002581 * t * t;
    let u = r - 24.0 * (date_time.year - 1900) as f64;

    let a = 0.0657098;
    let b = 24.0 - u;
    let c = 1.002738;
    let t0 = shift as f64 * a - b;

    let total_hours =
        date_time.hour as f64 + date_time.minute as f64 / 60.0 + date_time.second as f64 / 3600.0;
    let lst = (c * total_hours + t0) % 24.0;

    if lst < 0.0 { lst + 24.0 } else { lst }
}

pub fn vequinox_hour_angle(longitude: f64, date_time: DateTime) -> f64 {
    let sidereal = get_sidereal_time(longitude, date_time);
    // np.deg2rad(sidereal * 15.0)
    // sidereal * 15.0 * PI / 180.0 = sidereal * PI / 12.0
    sidereal * std::f64::consts::PI / 12.0
}
