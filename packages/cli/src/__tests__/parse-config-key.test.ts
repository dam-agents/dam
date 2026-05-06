import { describe, expect, it } from "vitest";
import { parseConfigKey } from "../modules/cli/domain/config.js";

describe("parseConfigKey", () => {
  it("accepts the known key 'server'", () => {
    const r = parseConfigKey("server");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("server");
  });

  it.each(["", "Server", "servr", "host", "url", "Server "])(
    "rejects %j with InvalidKeyError carrying the input and validKeys",
    (input) => {
      const r = parseConfigKey(input);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe("invalid-key");
        expect(r.error.input).toBe(input);
        expect(r.error.validKeys).toContain("server");
      }
    },
  );
});
