import { describe, expect, it } from "vitest";
import { parseCommandPattern, regexProbes, matchCommand } from "api-server-api";
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

describe("a manifest regex meeting a hostile argument", () => {
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
