// UNIT_BOUNDARY_DESCRIPTION: reads the Go files this crate mirrors, so a test can compare against them rather than against a copy of them made when the test was written. Deliberately not a Go parser: every reader here returns None or nothing for a shape it does not recognise, so an unfamiliar file fails the comparison that called it. A reader that guessed would agree with a file it had not understood, which is the one outcome worse than no guard at all.

pub fn read(relative: &str) -> String {
    let path = format!("../controller/pkg/vmrunner/{relative}");
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("the Go half of this contract is next door at {path}: {e}"))
}

// UNIT_BOUNDARY_DESCRIPTION: one `Name = "value"` from a Go const block. Only a quoted literal is recognised; anything else is None.
pub fn const_value(source: &str, name: &str) -> Option<String> {
    let value = source.lines().find_map(|line| {
        let (left, right) = line.split_once('=')?;
        (left.trim() == name).then(|| right.trim().to_string())
    })?;
    unquote(&value).map(str::to_string)
}

pub fn unquote(value: &str) -> Option<&str> {
    value.strip_prefix('"')?.strip_suffix('"')
}

// UNIT_BOUNDARY_DESCRIPTION: one field of a Go struct as the wire sees it — the JSON name it is written under, and whether Go leaves it out when it holds the zero value. Both halves matter: a name decides whether the other side finds the field at all, and omitempty decides whether it appears when unset, which a reader that treats absent and zero differently can tell apart.
#[derive(Debug, PartialEq, Eq)]
pub struct GoField {
    pub json: String,
    pub omitempty: bool,
}

// UNIT_BOUNDARY_DESCRIPTION: the json tags of one Go struct, in declaration order. A field with no json tag is skipped rather than guessed at, and so is anything between the braces that is not a tagged field, which is how the doc comments inside these structs are passed over.
pub fn struct_fields(source: &str, name: &str) -> Vec<GoField> {
    let header = format!("type {name} struct {{");
    let body = match source.split_once(&header) {
        Some((_, rest)) => match rest.split_once("\n}") {
            Some((body, _)) => body,
            None => return Vec::new(),
        },
        None => return Vec::new(),
    };
    body.lines()
        .filter_map(|line| {
            let tag = line.split_once("`json:\"")?.1.split_once('"')?.0;
            let (json, rest) = match tag.split_once(',') {
                Some((json, rest)) => (json, rest),
                None => (tag, ""),
            };
            (json != "-").then(|| GoField {
                json: json.to_string(),
                omitempty: rest.split(',').any(|opt| opt == "omitempty"),
            })
        })
        .collect()
}
