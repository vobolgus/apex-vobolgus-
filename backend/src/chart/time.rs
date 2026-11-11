//! The instant a chart is drawn for.

use chrono::{Datelike, Timelike};
use rust_core::time::DateTime;

/// The instant of a chart that names none, or none that can be read.
pub(super) const DEFAULT_TIME: DateTime = DateTime::new(2024, 6, 14, 6, 10, 0);

/// The same instant as the info line prints it for a chart that names none.
pub(super) const DEFAULT_TIME_TEXT: &str = "2024-06-14 06:10:00";

/// RFC 3339 (`2025-06-01T22:00:00Z`, as in SPEC), `YYYY-MM-DD HH:MM:SS` or a bare
/// date, read as UTC.
pub(super) fn parse_datetime(text: &str) -> Option<DateTime> {
    let naive = if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(text) {
        parsed.naive_utc()
    } else if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S") {
        naive
    } else {
        chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
            .ok()?
            .and_hms_opt(0, 0, 0)?
    };
    Some(DateTime::new(
        naive.year(),
        naive.month(),
        naive.day(),
        naive.hour(),
        naive.minute(),
        naive.second(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_rfc3339_datetimes() {
        let dt = parse_datetime("2025-06-01T22:00:00Z").unwrap();
        assert_eq!((dt.year, dt.month, dt.day, dt.hour), (2025, 6, 1, 22));
        let dt = parse_datetime("2025-06-02T01:30:00+03:00").unwrap();
        assert_eq!((dt.day, dt.hour, dt.minute), (1, 22, 30));
        assert!(parse_datetime("2025-06-01 22:00:00").is_some());
        assert!(parse_datetime("yesterday").is_none());
    }

    #[test]
    fn the_default_instant_is_the_one_its_text_names() {
        let dt = parse_datetime(DEFAULT_TIME_TEXT).unwrap();
        let fields = |dt: DateTime| (dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second);
        assert_eq!(fields(dt), fields(DEFAULT_TIME));
    }
}
