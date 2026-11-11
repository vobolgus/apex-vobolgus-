//! The wire format as the page reads it: the request and payload types and the
//! limits the page keeps to, written as TypeScript into `frontend/src/lib/api/wire/`.
//!
//! The Rust types are the one definition. `ts-rs` says each of them in TypeScript,
//! serde's names and defaults included, and this module lays the declarations out
//! the way the frontend's prettier would, so the files are checked in as they are
//! written. The test below fails when a checked-in file is not what the types say
//! now; `WIRE_TYPES=write cargo test -p backend wire` writes them again.
//!
//! All of it is test code: the server neither depends on `ts-rs` nor carries any
//! of this.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use ts_rs::{Config, TS};

use crate::chart::Projection;
use crate::handlers::catalog::CatalogQuery;
use crate::handlers::export::ExportQuery;
use crate::payload::{CatalogStar, ConstellationSegments, MessierEntry, SegmentPoint};
use crate::request::{
    DocumentItem, DocumentPage, DocumentRequest, DocumentRule, DocumentText, DocumentTextLine,
    LayersConfig, RenderConfig, SkyMark, StyleConfig, TextAnchor, TextFont, ViewConfig,
};

/// Where the files are kept, in the frontend's sources.
const FOLDER: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../frontend/src/lib/api/wire");

/// What writes the files again.
const COMMAND: &str = "WIRE_TYPES=write cargo test -p backend wire";

/// The longest line the frontend's prettier leaves alone.
const PRINT_WIDTH: usize = 100;

/// One generated file: its name, the lines of the comment that says what it holds,
/// and its declarations in the order they are written.
struct Module {
    file: &'static str,
    about: &'static [&'static str],
    declarations: Vec<Declaration>,
}

/// A type or a constant of a file: its name, how it is written, and the types it
/// names, which the same file has to declare.
struct Declaration {
    name: String,
    text: String,
    needs: BTreeSet<String>,
}

/// One of a module's constants as TypeScript, with the comment it has in its source.
macro_rules! constant {
    ($module:ident :: $name:ident) => {
        constant(
            include_str!(concat!(stringify!($module), ".rs")),
            stringify!($name),
            &crate::$module::$name.to_string(),
        )
    };
}

/// Every file of the folder. A type the page is to know of is named here, and so
/// is a limit: the page gets the ones it keeps to itself, not the server's own.
fn modules() -> Vec<Module> {
    vec![
        Module {
            file: "request.ts",
            about: &[
                "What a client sends: the queries of the catalogue and export routes and the",
                "JSON bodies of the export routes, as they are on the wire (backend/src/request.rs",
                "and the handlers).",
            ],
            declarations: vec![
                declaration::<CatalogQuery>(),
                declaration::<ExportQuery>(),
                declaration::<RenderConfig>(),
                declaration::<Projection>(),
                declaration::<SkyMark>(),
                declaration::<ViewConfig>(),
                declaration::<LayersConfig>(),
                declaration::<StyleConfig>(),
                declaration::<DocumentRequest>(),
                declaration::<DocumentPage>(),
                declaration::<DocumentItem>(),
                declaration::<DocumentText>(),
                declaration::<DocumentRule>(),
                declaration::<DocumentTextLine>(),
                declaration::<TextFont>(),
                declaration::<TextAnchor>(),
            ],
        },
        Module {
            file: "payload.ts",
            about: &["What the catalogue routes send (backend/src/payload.rs)."],
            declarations: vec![
                constant!(payload::FULL_MAX_MAG),
                declaration::<CatalogStar>(),
                declaration::<MessierEntry>(),
                declaration::<SegmentPoint>(),
                declaration::<ConstellationSegments>(),
            ],
        },
        Module {
            file: "limits.ts",
            about: &[
                "What a request may hold at most (backend/src/limits.rs): of the backend's limits,",
                "the ones the page keeps to itself. A document past them cannot be exported, so the",
                "editor does not build one.",
            ],
            declarations: vec![
                constant!(limits::MAX_MARKS),
                constant!(limits::MAX_PAGES),
                constant!(limits::MAX_ITEMS_PER_PAGE),
                constant!(limits::MAX_CHARTS),
                constant!(limits::MAX_TEXTS_PER_PAGE),
                constant!(limits::MAX_LINES_PER_TEXT),
                constant!(limits::MAX_LINE_CHARS),
            ],
        },
    ]
}

impl Module {
    /// The whole file: what it holds and where it comes from, then its declarations
    /// a blank line apart.
    fn text(&self) -> String {
        let written = format!("`{COMMAND}` writes it again after a change there.");
        let about = self.about.iter().copied().chain([
            "",
            "Written by the backend from its own types (backend/src/wire.rs), not by hand:",
            &written,
        ]);
        let mut text = comment("", about);
        for declaration in &self.declarations {
            text.push('\n');
            text.push_str(&declaration.text);
        }
        for line in text.lines() {
            assert!(
                width(line) <= PRINT_WIDTH,
                "prettier would break this line of {}, which this module cannot: {line}",
                self.file,
            );
        }
        text
    }

    /// The types its declarations name and it does not declare, each with who names it.
    fn undeclared(&self) -> Vec<String> {
        let declared: BTreeSet<&str> = self
            .declarations
            .iter()
            .map(|declaration| declaration.name.as_str())
            .collect();
        self.declarations
            .iter()
            .flat_map(|declaration| {
                declaration
                    .needs
                    .iter()
                    .filter(|need| !declared.contains(need.as_str()))
                    .map(|need| format!("{need} (in {})", declaration.name))
            })
            .collect()
    }
}

/// How wide prettier counts a line: a tab is two columns to it.
fn width(line: &str) -> usize {
    line.chars().count() + line.matches('\t').count()
}

/// A comment at `indent`: on one line when it is one, a block of them otherwise.
fn comment<'a>(indent: &str, lines: impl IntoIterator<Item = &'a str>) -> String {
    let lines: Vec<&str> = lines.into_iter().map(str::trim).collect();
    if let [line] = lines[..] {
        let whole = format!("{indent}/** {line} */\n");
        if width(whole.trim_end()) <= PRINT_WIDTH {
            return whole;
        }
    }
    let mut block = format!("{indent}/**\n");
    for line in lines {
        block.push_str(indent);
        block.push_str(if line.is_empty() { " *" } else { " * " });
        block.push_str(line);
        block.push('\n');
    }
    block.push_str(indent);
    block.push_str(" */\n");
    block
}

/// The lines of a comment as `ts-rs` writes it, without its frame.
fn comment_lines(block: &str) -> impl Iterator<Item = &str> {
    block
        .lines()
        .map(str::trim)
        .filter(|line| !matches!(*line, "/**" | "*/"))
        .map(|line| line.strip_prefix('*').unwrap_or(line))
}

/// A type as TypeScript: its comment, then `export type Name = …;`, an object's
/// members a line each under their own comments.
fn declaration<T: TS + 'static>() -> Declaration {
    let config = Config::new();
    let said = T::decl(&config);
    let (name, body) = said
        .strip_prefix("type ")
        .and_then(|rest| rest.strip_suffix(';'))
        .and_then(|rest| rest.split_once(" = "))
        .unwrap_or_else(|| panic!("ts-rs declares a type as `type Name = …;`, not as {said}"));

    let docs = T::docs().map_or_else(String::new, |docs| comment("", comment_lines(&docs)));
    let text = match body
        .trim()
        .strip_prefix('{')
        .and_then(|rest| rest.strip_suffix('}'))
    {
        None => format!("{docs}export type {name} = {};\n", single_quoted(body)),
        Some(members) => {
            let members: Vec<String> = members_of(members)
                .into_iter()
                .map(|(docs, member)| {
                    let docs = match docs {
                        "" => String::new(),
                        docs => comment("\t", comment_lines(docs)),
                    };
                    format!("{docs}\t{};\n", single_quoted(member))
                })
                .collect();
            format!("{docs}export type {name} = {{\n{}}};\n", members.concat())
        }
    };
    Declaration {
        name: name.to_owned(),
        text,
        needs: T::dependencies(&config)
            .into_iter()
            .map(|dependency| dependency.ts_name)
            .collect(),
    }
}

/// The members of an object type as `ts-rs` writes them, each with the comment
/// before it (empty when it has none): `/** … */ name: type,` one after another.
fn members_of(mut rest: &str) -> Vec<(&str, &str)> {
    let mut members = Vec::new();
    loop {
        rest = rest.trim_start();
        if rest.is_empty() {
            return members;
        }
        let docs = if rest.starts_with("/**") {
            let end = rest.find("*/").expect("a comment is closed") + "*/".len();
            let (docs, after) = rest.split_at(end);
            rest = after.trim_start();
            docs
        } else {
            ""
        };
        let end = end_of_member(rest);
        members.push((docs, rest[..end].trim()));
        rest = rest[end..].strip_prefix(',').unwrap_or(&rest[end..]);
    }
}

/// Where a member ends: at the first comma that is not inside brackets or a string.
fn end_of_member(text: &str) -> usize {
    let mut depth = 0_usize;
    let mut quoted = false;
    for (at, character) in text.char_indices() {
        match character {
            '"' => quoted = !quoted,
            _ if quoted => {}
            '{' | '[' | '(' | '<' => depth += 1,
            '}' | ']' | ')' | '>' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => return at,
            _ => {}
        }
    }
    text.len()
}

/// A type with its strings in single quotes, as the frontend writes them.
fn single_quoted(text: &str) -> String {
    assert!(
        !text.contains('\''),
        "a name with an apostrophe would have to keep its double quotes: {text}"
    );
    text.replace('"', "'")
}

/// A constant as TypeScript, under the comment it has in `source`, the text of the
/// Rust module that declares it.
fn constant(source: &str, name: &str, value: &str) -> Declaration {
    let lines: Vec<&str> = source.lines().collect();
    let declared = format!("pub(crate) const {name}:");
    let at = lines
        .iter()
        .position(|line| line.starts_with(&declared))
        .unwrap_or_else(|| panic!("{name} is declared at the start of a line of its module"));
    let mut docs: Vec<&str> = lines[..at]
        .iter()
        .rev()
        .map_while(|line| line.strip_prefix("///"))
        .collect();
    docs.reverse();
    Declaration {
        name: name.to_owned(),
        text: format!("{}export const {name} = {value};\n", comment("", docs)),
        needs: BTreeSet::new(),
    }
}

#[test]
fn the_checked_in_typescript_is_what_the_types_say_now() {
    let folder = Path::new(FOLDER);
    let modules = modules();
    if std::env::var_os("WIRE_TYPES").is_some_and(|mode| mode == "write") {
        fs::create_dir_all(folder).expect("the folder can be made");
        for module in &modules {
            fs::write(folder.join(module.file), module.text()).expect("the file can be written");
        }
    }

    for module in &modules {
        assert_eq!(
            module.undeclared(),
            [""; 0],
            "{} names types it does not declare: list them in `modules`",
            module.file,
        );
        let path = folder.join(module.file);
        let kept = fs::read_to_string(&path).unwrap_or_default();
        assert!(
            kept == module.text(),
            "{} is not what the backend's types say now: run `{COMMAND}` and check the result in",
            path.display(),
        );
    }
    let written: BTreeSet<String> = modules.iter().map(|module| module.file.into()).collect();
    let kept: BTreeSet<String> = fs::read_dir(folder)
        .expect("the folder is there")
        .map(|entry| entry.expect("the folder can be listed").file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        kept,
        written,
        "{} holds a file this module does not write",
        folder.display(),
    );
}

#[test]
fn a_projection_goes_by_the_name_the_page_is_told() {
    let said = Projection::inline(&Config::new());
    let names: Vec<&str> = said
        .split('|')
        .map(|name| name.trim().trim_matches('"'))
        .collect();
    assert_eq!(names, ["stereo", "pinhole"]);
    assert_eq!(names[0].parse(), Ok(Projection::Stereo));
    assert_eq!(names[1].parse(), Ok(Projection::Pinhole));
}

#[test]
fn an_object_is_a_member_a_line_under_its_own_comment() {
    /// A thing.
    #[derive(TS)]
    #[expect(dead_code, reason = "only its declaration is written, from the type")]
    struct Thing {
        /// Its name,
        /// in "full".
        name: String,
        pair: Option<[f32; 2]>,
        #[ts(optional)]
        kind: Option<Kind>,
        rows: Vec<Vec<Kind>>,
    }
    #[derive(TS)]
    #[expect(dead_code, reason = "only its declaration is written, from the type")]
    #[ts(rename_all = "lowercase")]
    enum Kind {
        One,
        Other,
    }

    assert_eq!(
        declaration::<Thing>().text,
        "/** A thing. */\n\
         export type Thing = {\n\
         \t/**\n\t * Its name,\n\t * in \"full\".\n\t */\n\
         \tname: string;\n\
         \tpair: [number, number] | null;\n\
         \tkind?: Kind;\n\
         \trows: Array<Array<Kind>>;\n\
         };\n"
    );
    assert_eq!(
        declaration::<Kind>().text,
        "export type Kind = 'one' | 'other';\n"
    );
    assert_eq!(
        declaration::<Thing>().needs,
        BTreeSet::from(["Kind".to_owned()])
    );
}

#[test]
fn a_constant_keeps_its_value_and_the_comment_of_its_source() {
    let source = "/// Something else.\npub(crate) const OTHER: usize = 1;\n\n\
                  /// Pages in one document,\n/// at most.\npub(crate) const MAX_PAGES: usize = 100;\n";
    assert_eq!(
        constant(source, "MAX_PAGES", "100").text,
        "/**\n * Pages in one document,\n * at most.\n */\nexport const MAX_PAGES = 100;\n"
    );
    assert_eq!(
        constant!(limits::MAX_LINES_PER_TEXT).text,
        "/**\n * Lines in one block of text: a page of 6 pt type is under 200, and a table is a\n \
         * line a cell (40 rows of 8 columns under a header).\n */\n\
         export const MAX_LINES_PER_TEXT = 400;\n"
    );
}
