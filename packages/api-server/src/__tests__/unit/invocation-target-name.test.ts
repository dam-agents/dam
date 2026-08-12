import { describe, expect, test } from "vitest";
import {
  invocationTargetName,
  isInvocationTargetName,
} from "../../modules/invocations/domain/target-name.js";

// Mint and recognizer must stay in lockstep: the metrics read path uses the
// recognizer to keep minted target names out of the per-agent spend rollup,
// so a mint the recognizer misses would leak `invocation-<hex>` bars again.
describe("invocation target name", () => {
  test("recognizes every minted name", () => {
    expect(isInvocationTargetName(invocationTargetName("7445bdaa11ff"))).toBe(
      true,
    );
  });

  test("mint refuses entropy the recognizer would miss", () => {
    for (const hex of [
      "7445bdaa11f", // 11 hex chars
      "7445bdaa11ff00", // 14 hex chars
      "7445BDAA11FF", // uppercase
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
      "invocation-7445bdaa11f", // 11 hex chars
      "invocation-7445bdaa11ffx",
      "my-invocation-7445bdaa11ff",
    ]) {
      expect(isInvocationTargetName(name)).toBe(false);
    }
  });
});
