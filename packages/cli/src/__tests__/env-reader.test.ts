import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProcessEnvReader } from "../modules/cli/infrastructure/env-reader.js";

const VAR = "__DAM_ENV_READER_TEST__";

describe("createProcessEnvReader", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[VAR];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[VAR];
    else process.env[VAR] = original;
  });

  it("returns the value when the variable is set", () => {
    process.env[VAR] = "https://example.test";
    expect(createProcessEnvReader().get(VAR)).toBe("https://example.test");
  });

  it("returns undefined when the variable is unset", () => {
    delete process.env[VAR];
    expect(createProcessEnvReader().get(VAR)).toBeUndefined();
  });

  it("returns undefined when the variable is the empty string", () => {
    // Empty exports (`DAM_SERVER=`) must look the same as 'unset' so that
    // `dam ping` produces the 'no server configured' hint, not a confusing
    // network error against an empty URL.
    process.env[VAR] = "";
    expect(createProcessEnvReader().get(VAR)).toBeUndefined();
  });
});
