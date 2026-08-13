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
