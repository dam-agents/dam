import { describe, expect, it } from "vitest";
import {
  MAX_MANIFEST_TOKENS,
  matchCommand,
  parseCommandPattern,
  regexProbes,
} from "api-server-api";
import { compileCommands } from "../../modules/satellites/domain/admission.js";
import {
  evaluateRegexProbes,
  oracleFor,
  RegexDeadlineError,
} from "../../modules/satellites/infrastructure/regex-worker.js";

/**
 * TEST_OVERVIEW: The api-server matches every command against the Satellite's
 * Manifest, so a Manifest regex meets an Agent-supplied argument on the server's
 * own thread. A pattern with a nested quantifier backtracks for longer than
 * anyone will wait, and a regex on the event loop cannot be abandoned — it would
 * stall every other request in the process, not just this owner's. These specs
 * pin that the evaluation happens off-thread under a deadline, that a pattern
 * exceeding it is refused rather than waited on, and that an ordinary pattern
 * still answers normally.
 */

function parse(run: string) {
  const parsed = parseCommandPattern(run);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe("the work the request thread pays before the deadline applies", () => {
  it("refuses a command whose patterns backtrack past the matcher's budget", () => {
    const nested = `./x ${"((a|a|a)...)... ".repeat(6)}z`;
    const argv = ["./x", ...Array.from({ length: 30 }, () => "a")];
    const result = matchCommand([parse(nested)], argv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("budget");
  });

  it("refuses a manifest that declares more tokens than the matcher will carry", () => {
    const wide = Array.from({ length: 300 }, (_, i) => ({
      run: `./x${i} ${"a ".repeat(20)}`,
    }));
    const compiled = compileCommands(wide);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error).toContain(String(MAX_MANIFEST_TOKENS));
  });
});

describe("a manifest regex meeting a hostile argument", () => {
  it("covers a glob token too, which compiles to a regex like any other", () => {
    const probes = regexProbes([parse("./x **/*.db")], ["./x", "a/b.db"]);
    expect(
      probes.map((probe) => probe.value),
      "every token must be probed, or the unprobed one falls back to the event loop",
    ).toEqual(["./x", "a/b.db", "./x", "a/b.db"]);
  });

  it("abandons an ambiguous glob chain, not only an explicit regex", async () => {
    const patterns = [parse("./x **/**/**/**/**/**/**/z")];
    const argv = ["./x", `${"a/".repeat(90)}b`];

    await expect(
      evaluateRegexProbes(regexProbes(patterns, argv), 100),
    ).rejects.toBeInstanceOf(RegexDeadlineError);
  });

  it("is abandoned at its deadline instead of stalling the server", async () => {
    const patterns = [parse("./x ^(a+)+$")];
    const argv = ["./x", `${"a".repeat(40)}b`];

    await expect(
      evaluateRegexProbes(regexProbes(patterns, argv), 100),
    ).rejects.toBeInstanceOf(RegexDeadlineError);
  });

  it("answers an ordinary pattern off-thread, and the matcher uses that answer", async () => {
    const patterns = [parse("./x ^v[0-9]+$")];
    const argv = ["./x", "v12"];

    const table = await evaluateRegexProbes(regexProbes(patterns, argv));
    expect(matchCommand(patterns, argv, oracleFor(table)).ok).toBe(true);

    const wrong = ["./x", "nope"];
    const wrongTable = await evaluateRegexProbes(regexProbes(patterns, wrong));
    expect(matchCommand(patterns, wrong, oracleFor(wrongTable)).ok).toBe(false);
  });
});
