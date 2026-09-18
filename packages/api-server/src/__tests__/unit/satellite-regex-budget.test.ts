import { describe, expect, it } from "vitest";
import {
  MAX_MANIFEST_TOKENS,
  matchCommand,
  parseCommandPattern,
  regexSources,
} from "api-server-api";
import { compileCommands } from "../../modules/satellites/domain/admission.js";
import {
  createRegexEvaluator,
  RegexDeadlineError,
} from "../../modules/satellites/infrastructure/regex-worker.js";

/**
 * TEST_OVERVIEW: The api-server matches every command against the Satellite's
 * Manifest, so a Manifest regex meets an Agent-supplied argument on the server's
 * own thread. A pattern with a nested quantifier backtracks for longer than
 * anyone will wait, and a regex on the event loop cannot be abandoned — it would
 * stall every other request in the process, not just this owner's. These specs
 * pin that the evaluation happens off-thread under a deadline charged to the
 * matching rather than to thread startup, that a pattern exceeding it is refused
 * rather than waited on, that the thread survives to serve the next command, and
 * that the work the request thread still does is bounded whatever a Manifest
 * declares.
 */

function parse(run: string) {
  const parsed = parseCommandPattern(run);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

async function warm(evaluator: ReturnType<typeof createRegexEvaluator>) {
  const patterns = [parse("./warm ^v[0-9]+$")];
  const oracle = await evaluator.oracleFor(regexSources(patterns), [
    "./warm",
    "v1",
  ]);
  expect(matchCommand(patterns, ["./warm", "v1"], oracle).ok).toBe(true);
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

  it("hands over one entry per distinct source, not one per source and argument", () => {
    const sources = regexSources([parse("./x **/*.db ^v[0-9]+$")]);
    expect(
      sources,
      "every token must be evaluated off-thread, glob tokens included",
    ).toHaveLength(3);
  });
});

describe("a manifest regex meeting a hostile argument", () => {
  it("is abandoned at its deadline instead of stalling the server", async () => {
    const evaluator = createRegexEvaluator(150);
    await warm(evaluator);

    const patterns = [parse("./x ^(a+)+$")];
    await expect(
      evaluator.oracleFor(regexSources(patterns), [
        "./x",
        `${"a".repeat(40)}b`,
      ]),
    ).rejects.toBeInstanceOf(RegexDeadlineError);

    await warm(evaluator);
    await evaluator.stop();
  });

  it("abandons an ambiguous glob chain, not only an explicit regex", async () => {
    const evaluator = createRegexEvaluator(150);
    await warm(evaluator);

    const patterns = [parse("./x **/**/**/**/**/**/**/z")];
    await expect(
      evaluator.oracleFor(regexSources(patterns), [
        "./x",
        `${"a/".repeat(90)}b`,
      ]),
    ).rejects.toBeInstanceOf(RegexDeadlineError);
    await evaluator.stop();
  });

  it("answers an ordinary pattern off-thread, and the matcher uses that answer", async () => {
    const evaluator = createRegexEvaluator();
    const patterns = [parse("./x ^v[0-9]+$")];

    const argv = ["./x", "v12"];
    const oracle = await evaluator.oracleFor(regexSources(patterns), argv);
    expect(matchCommand(patterns, argv, oracle).ok).toBe(true);

    const wrong = ["./x", "nope"];
    const wrongOracle = await evaluator.oracleFor(
      regexSources(patterns),
      wrong,
    );
    expect(matchCommand(patterns, wrong, wrongOracle).ok).toBe(false);

    await evaluator.stop();
  });

  it("charges the deadline to the matching, not to starting the thread", async () => {
    const evaluator = createRegexEvaluator(40);
    const patterns = [parse("./x ^v[0-9]+$")];
    const argv = ["./x", "v12"];

    const oracle = await evaluator.oracleFor(regexSources(patterns), argv);
    expect(
      matchCommand(patterns, argv, oracle).ok,
      "a deadline shorter than thread startup must still admit a pattern that matches at once",
    ).toBe(true);

    await evaluator.stop();
  });
});
