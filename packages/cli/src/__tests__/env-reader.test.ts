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

  it("treats the empty string as unset", () => {
    process.env[VAR] = "";
    expect(createProcessEnvReader().get(VAR)).toBeUndefined();
  });
});
