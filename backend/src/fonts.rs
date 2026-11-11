//! The fonts a PDF is set in.
//!
//! Text on a page of a document is laid out by the page editor in the browser and
//! drawn here, so both must hold the very same font files: PT Serif and PT Sans
//! (ParaType, free licence, Latin and Cyrillic), four faces each. There is one copy
//! of them, in the frontend's static folder, which serves them to the browser from
//! `/fonts/`; this server carries them in its binary. A chart's own text (planet
//! labels, constellation names) still names a system font, so those are loaded too.

use std::sync::{Arc, OnceLock};

use svg2pdf::usvg::fontdb;

/// The bytes of one font file of the frontend's static folder.
macro_rules! face {
    ($file:literal) => {
        include_bytes!(concat!("../../frontend/static/fonts/", $file)).as_slice()
    };
}

/// The bundled faces; each file names its own family, weight and style.
const FACES: [&[u8]; 8] = [
    face!("PTSerif-Regular.ttf"),
    face!("PTSerif-Italic.ttf"),
    face!("PTSerif-Bold.ttf"),
    face!("PTSerif-BoldItalic.ttf"),
    face!("PTSans-Regular.ttf"),
    face!("PTSans-Italic.ttf"),
    face!("PTSans-Bold.ttf"),
    face!("PTSans-BoldItalic.ttf"),
];

/// `font-family` of the bundled serif.
pub(crate) const SERIF: &str = "PT Serif";
/// `font-family` of the bundled sans.
pub(crate) const SANS: &str = "PT Sans";

/// The system fonts and the bundled faces, found once: scanning the font
/// directories on every export was a seventh of a PDF's CPU.
pub(crate) fn database() -> Arc<fontdb::Database> {
    static FONTS: OnceLock<Arc<fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut fonts = fontdb::Database::new();
            fonts.load_system_fonts();
            for face in FACES {
                // Shared, not copied: the bytes live in the binary.
                fonts.load_font_source(fontdb::Source::Binary(Arc::new(face)));
            }
            Arc::new(fonts)
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_families_have_their_four_faces() {
        let fonts = database();
        for family in [SERIF, SANS] {
            for weight in [fontdb::Weight::NORMAL, fontdb::Weight::BOLD] {
                for style in [fontdb::Style::Normal, fontdb::Style::Italic] {
                    let id = fonts
                        .query(&fontdb::Query {
                            families: &[fontdb::Family::Name(family)],
                            weight,
                            style,
                            stretch: fontdb::Stretch::Normal,
                        })
                        .unwrap_or_else(|| panic!("{family} {weight:?} {style:?} is missing"));
                    let face = fonts.face(id).unwrap();
                    // The very face, not the nearest one fontdb could find.
                    assert_eq!(face.weight, weight, "{family} {style:?}");
                    assert_eq!(face.style, style, "{family} {weight:?}");
                    assert!(face.families.iter().any(|(name, _)| name == family));
                }
            }
        }
    }
}
