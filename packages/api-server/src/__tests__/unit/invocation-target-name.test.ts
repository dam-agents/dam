import { describe, expect, test } from "vitest";
import {
  invocationTargetName,
  isInvocationTargetName,
} from "../../modules/invocations/domain/target-name.js";

describe("invocation target name", () => {
  test("recognizes every minted name", () => {
    expect(isInvocationTargetName(invocationTargetName("7445bdaa11ff"))).toBe(
      true,
    );
  });

  test("mint refuses entropy the recognizer would miss", () => {
    for (const hex of [
      "7445bdaa11f",
      "7445bdaa11ff00",
      "7445BDAA11FF",
      "not-hex-here",
    ]) {
      expect(() => invocationTargetName(hex)).toThrow(/lockstep/);
    }
  });

  // TEST_SCENARIO: a spawn's label names the sub-agent, so the label is part of the minted name; the recognizer must still know the name as a target's, or a finished target reappears in the spend views under the driver's own label.
  test("a label is carried in the name the recognizer knows", () => {
    const name = invocationTargetName("7445bdaa11ff", "summarize-readme");

    expect(name).toBe("invocation-summarize-readme-7445bdaa11ff");
    expect(isInvocationTargetName(name)).toBe(true);
  });

  test("a label is slugged to what a name may hold", () => {
    for (const [label, expected] of [
      ["Summarize README", "invocation-summarize-readme-7445bdaa11ff"],
      ["cell:one", "invocation-cell-one-7445bdaa11ff"],
      ["  spaced  ", "invocation-spaced-7445bdaa11ff"],
      ["a".repeat(80), `invocation-${"a".repeat(30)}-7445bdaa11ff`],
      ["!!!", "invocation-7445bdaa11ff"],
    ] as const) {
      const name = invocationTargetName("7445bdaa11ff", label);
      expect(name).toBe(expected);
      expect(isInvocationTargetName(name)).toBe(true);
    }
  });

  test("rejects real agent names, ids, and near-misses", () => {
    for (const name of [
      "stellar-sparrow",
      "",
      "agent-7445bdaa11ff",
      "invocation-7445bdaa11f",
      "invocation-7445bdaa11ffx",
      "my-invocation-7445bdaa11ff",
    ]) {
      expect(isInvocationTargetName(name)).toBe(false);
    }
  });
});
