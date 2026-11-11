//! SVG text, written piece by piece.
//!
//! A chart is some hundred kilobytes of elements, each a `format!` of its own. They
//! all go through [`SvgWriter`], so `write!(svg, ...)` appends in place and there is
//! no result to drop on every line: a `String` takes whatever is written to it.

use std::fmt;

/// An SVG document, or a part of one, being written.
#[derive(Debug, Default)]
pub(crate) struct SvgWriter {
    /// What has been written so far.
    text: String,
}

impl SvgWriter {
    /// An empty writer.
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// An empty writer with room for `bytes` of text, for output of a known size.
    pub(crate) fn with_capacity(bytes: usize) -> Self {
        Self {
            text: String::with_capacity(bytes),
        }
    }

    /// Appends formatted text. This is what `write!(svg, ...)` calls, and being an
    /// inherent method it returns nothing where `fmt::Write` returns a result.
    pub(crate) fn write_fmt(&mut self, args: fmt::Arguments<'_>) {
        fmt::Write::write_fmt(&mut self.text, args)
            .expect("a String takes every write, and numbers and text always format");
    }

    /// Appends `text` as it is.
    pub(crate) fn push_str(&mut self, text: &str) {
        self.text.push_str(text);
    }

    /// Nothing has been written yet.
    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    /// What has been written so far.
    #[cfg(test)]
    pub(crate) fn as_str(&self) -> &str {
        &self.text
    }
}

impl From<SvgWriter> for String {
    fn from(svg: SvgWriter) -> Self {
        svg.text
    }
}

/// Text as XML character data, escaped as it is displayed. A character XML has no
/// place for (a control character; a tab or a line break has no meaning inside a
/// line either) is a space.
pub(crate) struct CharacterData<'a>(pub(crate) &'a str);

impl fmt::Display for CharacterData<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use fmt::Write;

        for c in self.0.chars() {
            match c {
                '&' => f.write_str("&amp;")?,
                '<' => f.write_str("&lt;")?,
                '>' => f.write_str("&gt;")?,
                c if c.is_control() || matches!(c, '\u{FFFE}' | '\u{FFFF}') => f.write_char(' ')?,
                c => f.write_char(c)?,
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_appends_in_place() {
        let mut svg = SvgWriter::new();
        assert!(svg.is_empty());
        write!(svg, r#"<circle r="{:.2}" />"#, 1.0_f32);
        svg.push_str("</g>");
        assert_eq!(svg.as_str(), r#"<circle r="1.00" /></g>"#);
        assert_eq!(String::from(svg), r#"<circle r="1.00" /></g>"#);
    }

    #[test]
    fn character_data_escapes_markup_and_blanks_what_xml_cannot_hold() {
        let escaped = CharacterData("φ < 56° & \"LST\" > 13h\tи\u{7}время\u{FFFF}").to_string();
        assert_eq!(escaped, "φ &lt; 56° &amp; \"LST\" &gt; 13h и время ");
    }
}
