import { describe, expect, it } from "vitest";
import {
  matchCommand,
  parseCommandPattern,
  type ParsedPattern,
} from "api-server-api";

/**
 * TEST_OVERVIEW: The Command Pattern grammar, which decides what a Satellite is
 * allowed to run. A pattern is a usage line: literals match exactly, (a|b) is a
 * closed set, [x] is optional, (x)... repeats, and <name:format> is a value the
 * caller supplies. The grammar has no free-form string form, so a pattern can
 * only ever describe a finite set of commands — that is the security property,
 * and the specs here pin the ways it could leak: a pattern whose first token is
 * not a literal (the caller would choose the program), a captured value that
 * starts with a dash and would read as an extra flag, a path glob that would
 * admit a .. segment and escape its directory, an unanchored regex, and an
 * argument or argv longer than the caps. Refusals must also teach: they name the
 * pattern that came closest and where the match broke.
 */

function parse(...runs: string[]): ParsedPattern[] {
  return runs.map((run) => {
    const result = parseCommandPattern(run);
    if (!result.ok) throw new Error(`${run}: ${result.error}`);
    return result.value;
  });
}

function accepts(patterns: ParsedPattern[], argv: string[]): boolean {
  return matchCommand(patterns, argv).ok;
}

describe("command pattern parsing", () => {
  it("refuses a pattern whose program the caller chooses", () => {
    for (const run of ["<cmd>", "(ls|rm)", "[./x]"]) {
      const result = parseCommandPattern(run);
      expect(result.ok, run).toBe(false);
    }
  });

  it("refuses formats that are not one of the four shapes", () => {
    const result = parseCommandPattern("./x <a:whatever>");
    expect(result.ok).toBe(false);
  });

  it("refuses an unanchored regex format", () => {
    expect(parseCommandPattern("./x <a:^v[0-9]+>").ok).toBe(false);
    expect(parseCommandPattern("./x <a:^v[0-9]+$>").ok).toBe(true);
  });

  it("refuses unbalanced groups", () => {
    expect(parseCommandPattern("./x [-n <n:0+>").ok).toBe(false);
    expect(parseCommandPattern("./x (a|b").ok).toBe(false);
  });
});

describe("literals and alternation", () => {
  const patterns = parse(
    "./process.sh (sales.db|events.db) [-n <count:1-9999>]",
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

  it("refuses an int outside its range", () => {
    expect(accepts(patterns, ["./process.sh", "sales.db", "-n", "9999"])).toBe(
      true,
    );
    expect(accepts(patterns, ["./process.sh", "sales.db", "-n", "10000"])).toBe(
      false,
    );
    expect(accepts(patterns, ["./process.sh", "sales.db", "-n", "0"])).toBe(
      false,
    );
  });
});

describe("the leading-dash rule", () => {
  const patterns = parse("./x <name>", "./y -- <name>");

  it("refuses a captured value that would read as a flag", () => {
    expect(accepts(patterns, ["./x", "ok"])).toBe(true);
    expect(accepts(patterns, ["./x", "-rf"])).toBe(false);
    expect(accepts(patterns, ["./x", "--force"])).toBe(false);
  });

  it("permits one after a literal --", () => {
    expect(accepts(patterns, ["./y", "--", "-rf"])).toBe(true);
  });

  it("constrains the value, not the token", () => {
    const composite = parse("./z [--limit=<n:1-100>]");
    expect(accepts(composite, ["./z", "--limit=50"])).toBe(true);
    expect(accepts(composite, ["./z", "--limit=500"])).toBe(false);
  });
});

describe("path formats", () => {
  const patterns = parse("./train.sh <dataset:./data/**/*.db>");

  it("accepts paths inside the glob", () => {
    expect(accepts(patterns, ["./train.sh", "./data/a.db"])).toBe(true);
    expect(accepts(patterns, ["./train.sh", "./data/x/y/b.db"])).toBe(true);
  });

  it("refuses paths outside it", () => {
    expect(accepts(patterns, ["./train.sh", "./other/a.db"])).toBe(false);
    expect(accepts(patterns, ["./train.sh", "./data/a.txt"])).toBe(false);
  });

  it("refuses traversal that the glob would otherwise admit", () => {
    expect(
      accepts(patterns, ["./train.sh", "./data/../../etc/shadow.db"]),
    ).toBe(false);
  });
});

describe("repetition", () => {
  const patterns = parse("./tag.sh (<tag:^v[0-9]+$>)...");

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
  const patterns = parse(
    "./process.sh (sales.db|events.db) [-n <count:1-9999>]",
  );

  it("names the closest pattern and where the match broke", () => {
    const result = matchCommand(patterns, ["./process.sh", "secrets.db"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.closest).toBe(
      "./process.sh (sales.db|events.db) [-n <count:1-9999>]",
    );
    expect(result.reason).toContain("secrets.db");
  });

  it("says so plainly when nothing starts with the program", () => {
    const result = matchCommand(patterns, ["./nope.sh"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.closest).toBeNull();
    expect(result.reason).toContain("./nope.sh");
  });
});

describe("size caps", () => {
  const patterns = parse("./x (<a>)...");

  it("refuses an over-long argument", () => {
    expect(accepts(patterns, ["./x", "a".repeat(5000)])).toBe(false);
  });

  it("refuses an over-long argv", () => {
    expect(accepts(patterns, ["./x", ...Array(100).fill("a")])).toBe(false);
  });
});
