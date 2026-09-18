import { describe, expect, it } from "vitest";
import {
  localOracle,
  matchCommand,
  parseCommandPattern,
  type ParsedPattern,
} from "api-server-api";

/**
 * TEST_OVERVIEW: The Command Pattern grammar, which decides what a Satellite is
 * allowed to run. A pattern is a usage line built from seven forms: literals,
 * (a|b) for a closed set, [x] for optional, (x)... for repeats, * for one
 * filename-like argument, ** for a path-like one, and ^…$ for a regex covering
 * a whole argument. There are no named placeholders and no sub-part regexes, so
 * the only way to constrain part of an argument is a regex over all of it.
 *
 * The specs pin the ways a pattern could leak: a first token that is not a
 * literal, so the caller would choose the program; a matched value that begins
 * with a dash and would read as an extra flag; a value carrying a .. segment
 * that would climb out of the directory the pattern named; a regex that is not
 * anchored over the whole argument; and arguments or argv beyond the caps.
 * Refusals must teach — they name the pattern that came closest and where the
 * match broke.
 */

function parse(...runs: string[]): ParsedPattern[] {
  return runs.map((run) => {
    const result = parseCommandPattern(run);
    if (!result.ok) throw new Error(`${run}: ${result.error}`);
    return result.value;
  });
}

function accepts(patterns: ParsedPattern[], argv: string[]): boolean {
  return matchCommand(patterns, argv, localOracle).ok;
}

describe("command pattern parsing", () => {
  it("refuses a pattern whose program the caller chooses", () => {
    for (const run of ["*", "**", "(ls|rm)", "[./x]", "^.*$"]) {
      const result = parseCommandPattern(run);
      expect(result.ok, run).toBe(false);
    }
  });

  it("refuses a regex that does not cover the whole argument", () => {
    expect(parseCommandPattern("./x --limit=^[0-9]+$").ok).toBe(false);
    expect(parseCommandPattern("./x ^--limit=[0-9]+$").ok).toBe(true);
  });

  it("refuses an unbalanced group", () => {
    expect(parseCommandPattern("./x [-n *").ok).toBe(false);
    expect(parseCommandPattern("./x (a|b").ok).toBe(false);
  });
});

describe("literals and alternation", () => {
  const patterns = parse(
    "./process.sh (sales.db|events.db) [-n *]",
    "git -C /srv/repo (pull|status)",
  );

  it("accepts exactly what the pattern describes", () => {
    expect(accepts(patterns, ["./process.sh", "sales.db"])).toBe(true);
    expect(accepts(patterns, ["./process.sh", "events.db", "-n", "50"])).toBe(
      true,
    );
    expect(accepts(patterns, ["git", "-C", "/srv/repo", "pull"])).toBe(true);
  });

  it("refuses values outside the alternation", () => {
    expect(accepts(patterns, ["./process.sh", "secrets.db"])).toBe(false);
    expect(accepts(patterns, ["git", "-C", "/etc", "pull"])).toBe(false);
    expect(accepts(patterns, ["git", "-C", "/srv/repo", "push"])).toBe(false);
  });

  it("refuses trailing arguments the pattern does not mention", () => {
    expect(accepts(patterns, ["./process.sh", "sales.db", "--force"])).toBe(
      false,
    );
    expect(accepts(patterns, ["./process.sh"])).toBe(false);
  });
});

describe("the leading-dash rule", () => {
  const patterns = parse("./x *", "./y -- *");

  it("refuses a matched value that would read as a flag", () => {
    expect(accepts(patterns, ["./x", "ok"])).toBe(true);
    expect(accepts(patterns, ["./x", "-rf"])).toBe(false);
    expect(accepts(patterns, ["./x", "--force"])).toBe(false);
  });

  it("permits one after a literal --", () => {
    expect(accepts(patterns, ["./y", "--", "-rf"])).toBe(true);
  });

  it("constrains the value, not the token", () => {
    const composite = parse("./z [--limit=*]");
    expect(accepts(composite, ["./z", "--limit=50"])).toBe(true);
  });
});

describe("stars", () => {
  const single = parse("./train.sh ./data/*.db");
  const double = parse("./train.sh ./data/**/*.db");

  it("keeps a single star inside one path segment", () => {
    expect(accepts(single, ["./train.sh", "./data/a.db"])).toBe(true);
    expect(accepts(single, ["./train.sh", "./data/x/b.db"])).toBe(false);
  });

  it("lets a double star span segments, including none", () => {
    expect(accepts(double, ["./train.sh", "./data/a.db"])).toBe(true);
    expect(accepts(double, ["./train.sh", "./data/x/y/b.db"])).toBe(true);
  });

  it("still holds the literal parts around a star", () => {
    expect(accepts(double, ["./train.sh", "./other/a.db"])).toBe(false);
    expect(accepts(double, ["./train.sh", "./data/a.txt"])).toBe(false);
  });

  it("refuses traversal that a star would otherwise admit", () => {
    expect(accepts(double, ["./train.sh", "./data/../../etc/shadow.db"])).toBe(
      false,
    );
  });
});

describe("whole-argument regex", () => {
  const patterns = parse(
    "./tag.sh ^v[0-9]+$",
    "./limit.sh ^--limit=[1-9][0-9]?$",
  );

  it("matches the argument end to end", () => {
    expect(accepts(patterns, ["./tag.sh", "v12"])).toBe(true);
    expect(accepts(patterns, ["./tag.sh", "v12x"])).toBe(false);
    expect(accepts(patterns, ["./tag.sh", "xv12"])).toBe(false);
  });

  it("is how a flag's value is constrained, now that regexes are whole-argument", () => {
    expect(accepts(patterns, ["./limit.sh", "--limit=50"])).toBe(true);
    expect(accepts(patterns, ["./limit.sh", "--limit=500"])).toBe(false);
  });

  it("may name a leading dash itself, because the author spelled the whole argument", () => {
    const flag = parse("./x ^--force$");
    expect(accepts(flag, ["./x", "--force"])).toBe(true);
  });

  it("holds the anchors across a top-level alternation", () => {
    const alternation = parse("./x ^a$|^b$");
    expect(accepts(alternation, ["./x", "a"])).toBe(true);
    expect(accepts(alternation, ["./x", "b"])).toBe(true);
    expect(accepts(alternation, ["./x", "xb"])).toBe(false);
    expect(accepts(alternation, ["./x", "ay"])).toBe(false);
  });

  it("is still subject to the traversal rule", () => {
    const loose = parse("./read.sh ^[a-z./]+$");
    expect(accepts(loose, ["./read.sh", "./data/x"])).toBe(true);
    expect(accepts(loose, ["./read.sh", "../etc/passwd"])).toBe(false);
  });
});

describe("repetition", () => {
  const patterns = parse("./tag.sh (^v[0-9]+$)...");

  it("accepts one or more", () => {
    expect(accepts(patterns, ["./tag.sh", "v1"])).toBe(true);
    expect(accepts(patterns, ["./tag.sh", "v1", "v2", "v3"])).toBe(true);
  });

  it("refuses none, and refuses values failing the regex", () => {
    expect(accepts(patterns, ["./tag.sh"])).toBe(false);
    expect(accepts(patterns, ["./tag.sh", "v1", "nope"])).toBe(false);
  });

  it("stops at the repeat cap", () => {
    const many = Array.from({ length: 20 }, (_, i) => `v${i}`);
    expect(accepts(patterns, ["./tag.sh", ...many])).toBe(false);
  });
});

describe("refusals teach", () => {
  const patterns = parse("./process.sh (sales.db|events.db) [-n *]");

  it("names the closest pattern and where the match broke", () => {
    const result = matchCommand(
      patterns,
      ["./process.sh", "secrets.db"],
      localOracle,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.closest).toBe("./process.sh (sales.db|events.db) [-n *]");
    expect(result.reason).toContain("secrets.db");
  });

  it("says so plainly when nothing starts with the program", () => {
    const result = matchCommand(patterns, ["./nope.sh"], localOracle);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.closest).toBeNull();
    expect(result.reason).toContain("./nope.sh");
  });
});

describe("size caps", () => {
  const patterns = parse("./x (*)...");

  it("refuses an over-long argument", () => {
    expect(accepts(patterns, ["./x", "a".repeat(5000)])).toBe(false);
  });

  it("refuses an over-long argv", () => {
    expect(accepts(patterns, ["./x", ...Array(100).fill("a")])).toBe(false);
  });
});
