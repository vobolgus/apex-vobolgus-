//! Calendar time on the astronomer's clocks: the Julian Date of a calendar day and
//! the sidereal time that turns the sky.

/// A calendar date and time of day in UT, to the second.
///
/// Years are numbered astronomically (1 BC is year 0). Dates up to 1582 October 4
/// are read in the Julian calendar, later ones in the Gregorian.
#[derive(Debug, Clone, Copy)]
pub struct DateTime {
    /// Year, astronomical numbering.
    pub year: i32,
    /// Month, 1 to 12.
    pub month: u32,
    /// Day of the month, from 1.
    pub day: u32,
    /// Hour, 0 to 23.
    pub hour: u32,
    /// Minute, 0 to 59.
    pub minute: u32,
    /// Second, 0 to 59.
    pub second: u32,
}

impl DateTime {
    /// A date and time from its fields, unchecked.
    #[must_use]
    pub const fn new(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> Self {
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

/// The Julian Date at 0h UT of a calendar date (Meeus, *Astronomical Algorithms*,
/// chapter 7): 2000 January 1 is 2451544.5.
#[must_use]
pub fn julian_date(year: i32, month: u32, day: u32) -> f64 {
    let (y, m) = if month > 2 {
        (year, month as i32)
    } else {
        (year - 1, month as i32 + 12)
    };

    let d = f64::from(day);

    let b =
        if year < 1582 || (year == 1582 && month < 10) || (year == 1582 && month == 10 && day <= 4)
        {
            0.0
        } else {
            let a = (f64::from(y) / 100.0).floor();
            2.0 - a + (a / 4.0).floor()
        };

    (365.25 * f64::from(y)).floor() + (30.6001 * f64::from(m + 1)).floor() + d + b + 1720994.5
}

/// The sidereal time at `date_time`, in hours in `[0, 24)`.
///
/// The longitude (radians, east positive) is not applied, so this is in effect
/// the mean sidereal time at Greenwich: the Python program this was ported from
/// declared the parameter without using it, and charts are kept as it drew them.
#[must_use]
#[expect(
    unused_variables,
    reason = "the longitude is declared as the Python original declared it, and not applied"
)]
pub fn sidereal_time(longitude_rad: f64, date_time: DateTime) -> f64 {
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
    let u = r - 24.0 * f64::from(date_time.year - 1900);

    let a = 0.0657098;
    let b = 24.0 - u;
    let c = 1.002738;
    let t0 = f64::from(shift) * a - b;

    let total_hours = f64::from(date_time.hour)
        + f64::from(date_time.minute) / 60.0
        + f64::from(date_time.second) / 3600.0;
    let lst = (c * total_hours + t0) % 24.0;

    if lst < 0.0 { lst + 24.0 } else { lst }
}

/// The hour angle of the vernal equinox at `date_time`, in radians: the
/// [`sidereal_time`] as an angle. The longitude, in radians, is passed on to it
/// (and not applied there).
#[must_use]
pub fn vernal_equinox_hour_angle(longitude_rad: f64, date_time: DateTime) -> f64 {
    let sidereal = sidereal_time(longitude_rad, date_time);
    // np.deg2rad(sidereal * 15.0)
    // sidereal * 15.0 * PI / 180.0 = sidereal * PI / 12.0
    sidereal * std::f64::consts::PI / 12.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_julian_date() {
        // Проверяем известную юлианскую дату
        // 2000-01-01 12:00:00 UTC имеет JD = 2451545.0
        // Наша функция julian_date рассчитывает JD на начало дня (00:00:00),
        // поэтому julian_date(2000, 1, 1) вернет 2451544.5.
        let jd = julian_date(2000, 1, 1);
        assert_eq!(jd, 2451544.5);

        // Еще один тест: 1970-01-01
        let jd_epoch = julian_date(1970, 1, 1);
        assert_eq!(jd_epoch, 2440587.5);
    }

    #[test]
    fn test_sidereal_time_longitude_ignored() {
        // Убеждаемся, что LST возвращает одинаковое значение независимо от longitude,
        // сохраняя зафиксированный баг совместимости с Python.
        let dt = DateTime::new(2024, 5, 20, 22, 0, 0);
        let lst1 = sidereal_time(10.0, dt);
        let lst2 = sidereal_time(100.0, dt);
        assert_eq!(lst1, lst2);
        assert!((0.0..24.0).contains(&lst1));
    }
}
