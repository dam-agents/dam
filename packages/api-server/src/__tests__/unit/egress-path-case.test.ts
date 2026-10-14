// TEST_OVERVIEW: GitHub resolves owner and repository in any letter case, so on its hosts a deny rule matches the request path in any case, while an allow keeps exact case; every other host matches exact case.
import { describe, it, expect } from "vitest";
import { denyIgnoresPathCase } from "../../modules/egress-rules/domain/path-case.js";

describe("denyIgnoresPathCase", () => {
  // TEST_SCENARIO: the hosts GitHub serves repositories from, GHE.com included, fold case; a look-alike or unrelated host does not.
  it("folds case only on GitHub hosts", () => {
    for (const host of [
      "github.com",
      "api.github.com",
      "codeload.github.com",
      "raw.githubusercontent.com",
      "API.GitHub.com",
      "api.acme.ghe.com",
    ]) {
      expect(denyIgnoresPathCase(host), host).toBe(true);
    }
    for (const host of [
      "postman-echo.com",
      "github.com.evil.io",
      "evilghe.com",
      "gist.githubusercontent.com.example",
    ]) {
      expect(denyIgnoresPathCase(host), host).toBe(false);
    }
  });
});
