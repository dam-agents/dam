// UNIT_BOUNDARY_DESCRIPTION: reads the Go files this crate mirrors, so a test can compare against them rather than against a copy of them made when the test was written. Deliberately not a Go parser: every reader here returns None or nothing for a shape it does not recognise, so an unfamiliar file fails the comparison that called it. A reader that guessed would agree with a file it had not understood, which is the one outcome worse than no guard at all.

pub fn read(relative: &str) -> String {
    read_in("vmrunner", relative)
}

// UNIT_BOUNDARY_DESCRIPTION: a Go file from another package of the controller. Some of what this crate writes is read by something further away than the runner — the share's CA file is named in the agent's environment, a package away — and a contract is only pinned against the file that actually states it.
pub fn read_in(package: &str, relative: &str) -> String {
    let path = format!("../controller/pkg/{package}/{relative}");
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

// UNIT_BOUNDARY_DESCRIPTION: one `Name = 30 * time.Minute` from a Go const block, as a Duration. Only the `count * unit` form is recognised, where the unit is a `time.` constant or another const in the same file — which is every window this crate has to agree with the Go runner about. A bare `time.Second`, an added expression, anything else: None, so the comparison that asked fails rather than passes on a shape this reader did not understand.
pub fn duration_value(source: &str, name: &str) -> Option<std::time::Duration> {
    duration_within(source, name, 4)
}

fn duration_within(source: &str, name: &str, depth: u8) -> Option<std::time::Duration> {
    if depth == 0 {
        return None;
    }
    let raw = source.lines().find_map(|line| {
        let (left, right) = line.split_once('=')?;
        (left.trim() == name).then(|| right.trim().to_string())
    })?;
    let expression = raw.split("//").next()?.trim();
    let (count, unit) = expression.split_once('*')?;
    let count: u32 = count.trim().parse().ok()?;
    let unit = unit.trim();
    let one = match unit {
        "time.Nanosecond" => std::time::Duration::from_nanos(1),
        "time.Microsecond" => std::time::Duration::from_micros(1),
        "time.Millisecond" => std::time::Duration::from_millis(1),
        "time.Second" => std::time::Duration::from_secs(1),
        "time.Minute" => std::time::Duration::from_secs(60),
        "time.Hour" => std::time::Duration::from_secs(60 * 60),
        named => duration_within(source, named, depth - 1)?,
    };
    one.checked_mul(count)
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

// UNIT_BOUNDARY_DESCRIPTION: the text of a Go `var name = regexp.MustCompile(`…`)`, so a hand-written matcher on this side can be pinned to the pattern it was written against. The pattern is not interpreted — only compared — because a Rust regex engine agreeing with Go's proves nothing about a matcher that uses neither.
pub fn regexp_source(source: &str, name: &str) -> Option<String> {
    let line = source
        .lines()
        .find(|line| line.starts_with(&format!("var {name} = regexp.MustCompile(")))?;
    let body = line.split_once('`')?.1;
    Some(body.split_once('`')?.0.to_string())
}

// UNIT_BOUNDARY_DESCRIPTION: the argument list of a Go call inside one named function, as written. Scoped to the function because a call this common appears more than once in a file — an earlier version of this took the first line in the file that contained it and read a log sanitiser's replacements as the cache's, which is the whole failure this module exists to avoid: agreeing confidently with something it had not located.
pub fn call_args_in(source: &str, function: &str, call: &str) -> Option<String> {
    let after = function_body(source, function)?
        .split_once(call)?
        .1
        .to_string();
    Some(after.split_once(')')?.0.to_string())
}

// UNIT_BOUNDARY_DESCRIPTION: every double-quoted Go string literal inside one named function, in order and unescaped only as far as recognising where each one ends. Needed because the argument reader below stops at the first `)`, and the messages this crate has to match word for word contain their own parentheses — reading one with that reader returns half a sentence and compares it confidently.
pub fn literals_in(source: &str, function: &str) -> Vec<String> {
    let Some(body) = function_body(source, function) else {
        return Vec::new();
    };
    let mut literals = Vec::new();
    let mut chars = body.chars();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut literal = String::new();
        loop {
            match chars.next() {
                Some('\\') => match chars.next() {
                    Some(escaped) => {
                        literal.push('\\');
                        literal.push(escaped);
                    }
                    None => break,
                },
                Some('"') | None => break,
                Some(c) => literal.push(c),
            }
        }
        literals.push(literal);
    }
    literals
}

// UNIT_BOUNDARY_DESCRIPTION: the text of one Go function, ending at the first line that is a closing brace in the first column. Used where the shape being compared is a literal the function contains rather than an argument list a reader can take apart — a containment check against the whole file would find the same words somewhere else and agree with the wrong function.
pub fn function_body<'a>(source: &'a str, function: &str) -> Option<&'a str> {
    let body = source.split_once(&format!("func {function}"))?.1;
    Some(body.split_once("\n}")?.0)
}
