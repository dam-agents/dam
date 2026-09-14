import { describe, expect, it } from "vitest";

import { err, ok } from "../../core/result.js";
import { verdictFor } from "../../modules/runtime-channel/domain/precheck.js";

// TEST_OVERVIEW: The exit-code contract a Precheck is written against — which endings mean "nothing changed" and which mean the check itself broke — and what a fire hands the turn it allows.
describe("precheck verdict", () => {
  // TEST_SCENARIO: exit 1 is the one ending that means "nothing changed", the grep convention every shell one-liner already follows.
  it("reads exit 1 as a decline", () => {
    expect(
      verdictFor(err({ kind: "exited", code: 1, stderr: "", stdout: "" })),
    ).toEqual({ verdict: "declined" });
  });

  // TEST_SCENARIO: a missing script exits 127 and a non-executable one 126 — those are the check breaking, not saying no, so the run must go ahead and the reason must survive.
  it("reads any other exit as the precheck breaking, with the reason", () => {
    const outcome = verdictFor(
      err({ kind: "exited", code: 127, stderr: "no such file", stdout: "" }),
    );

    expect(outcome.verdict).toBe("precheck-failed");
    expect(outcome.detail).toContain("127");
    expect(outcome.context).toContain("no precheck result");
  });

  // TEST_SCENARIO: what the cheap check printed is what the expensive turn would otherwise re-derive, so it rides along as context.
  it("carries stdout as context when it allows the run", () => {
    expect(verdictFor(ok({ stdout: "  PR 7 landed\n", stderr: "" }))).toEqual({
      verdict: "allowed",
      context: "PR 7 landed",
    });
  });

  // TEST_SCENARIO: a task written as "see the precheck output below" must never be followed by nothing — a check that printed its findings and then botched its exit code still hands them over, marked as unverified.
  it("keeps what a failing precheck printed, and says it failed", () => {
    const outcome = verdictFor(
      err({
        kind: "exited",
        code: 2,
        stderr: "boom",
        stdout: "test/a.txt\ntest/b.txt",
      }),
    );

    expect(outcome.verdict).toBe("precheck-failed");
    expect(outcome.context).toContain("test/a.txt");
    expect(outcome.context).toContain("The precheck failed after printing");
  });
});
