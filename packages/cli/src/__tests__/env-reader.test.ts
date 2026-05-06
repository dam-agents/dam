import { afterEach, describe, expect, it } from "vitest";
import { createProcessEnvReader } from "../modules/cli/infrastructure/env-reader.js";

const SENTINEL = "DAM_CLI_TEST_PROBE";

describe("process.env EnvReader", () => {
  afterEach(() => {
    delete process.env[SENTINEL];
  });

  it("returns the value of a set var", () => {
    process.env[SENTINEL] = "https://probe.test";
    expect(createProcessEnvReader().get(SENTINEL)).toBe("https://probe.test");
  });

  it("returns undefined for an unset var", () => {
    delete process.env[SENTINEL];
    expect(createProcessEnvReader().get(SENTINEL)).toBeUndefined();
  });
});
