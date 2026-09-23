// UNIT_BOUNDARY_DESCRIPTION: reads the Go contract files that remain in the controller — api.go, which the controller's client speaks to this runner, and guest.go, which platform-init reads inside a machine — so a test can compare against them rather than against a copy made when the test was written. Deliberately not a Go parser: every reader here returns None or nothing for a shape it does not recognise, so an unfamiliar file fails the comparison that called it. A reader that guessed would agree with a file it had not understood, which is the one outcome worse than no guard at all.

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

// UNIT_BOUNDARY_DESCRIPTION: the text of one Go function, found by its declaration up to and including the opening parenthesis of its parameter list, and ending at the first line that is a closing brace in the first column. Used where the shape being compared is a literal the function contains rather than an argument list a reader can take apart — a containment check against the whole file would find the same words somewhere else and agree with the wrong function. The parenthesis is what makes the name exact: without it `writeSpec` also matches a `writeSpecSomething` declared later, so a rename would silently hand back the wrong body instead of failing.
pub fn function_body<'a>(source: &'a str, function: &str) -> Option<&'a str> {
    let body = source.split_once(&format!("func {function}("))?.1;
    Some(body.split_once("\n}")?.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEST_SCENARIO: a reader that locates the wrong function is worse than no reader, because every guard built on it then compares the right shape against the wrong body and agrees. `function_body` finds a declaration by name, and a name is a prefix of every longer name — so `writeSpec` would also select a `writeSpecAndIndex` declared later, and a rename that should fail a drift guard would instead hand back a body that still happens to match. The declaration is matched up to its opening parenthesis for that reason, and this is the test that keeps it there.
    #[test]
    fn a_function_name_does_not_select_a_longer_one() {
        let source = "\
func writeSpecAndIndex(a int) error {
\tsentinel: longer name
}

func writeSpec(a int) error {
\tsentinel: exact name
}
";
        assert!(
            function_body(source, "writeSpec")
                .expect("the exactly named function is there")
                .contains("sentinel: exact name"),
            "function_body selected a function whose name merely starts with the one it was asked for"
        );
        assert_eq!(
            function_body(source, "writeSpe"),
            None,
            "a name that is only a prefix of a real declaration must not resolve at all"
        );
    }
}
