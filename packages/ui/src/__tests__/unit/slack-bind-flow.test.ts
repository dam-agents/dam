import { describe, expect, it } from "vitest";

import { pathToState, viewToPath } from "../../modules/platform/lib/routes.js";
import {
  bindErrorCopy,
  callbackErrorCopy,
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../../modules/slack/lib/bind-flow.js";

const BRAND = "acme";

describe("slack bind flow helpers", () => {
  it("reads the flow id from the search string", () => {
    expect(readFlowIdFromSearch("?flow=abc-123")).toBe("abc-123");
    expect(readFlowIdFromSearch("?flow=abc&x=1")).toBe("abc");
    expect(readFlowIdFromSearch("?x=1")).toBe(null);
    expect(readFlowIdFromSearch("?flow=")).toBe(null);
    expect(readFlowIdFromSearch("")).toBe(null);
  });

  it("reads the callback error", () => {
    expect(readCallbackErrorFromSearch("?error=expired")).toBe("expired");
    expect(readCallbackErrorFromSearch("?flow=abc")).toBe(null);
  });

  it("maps bind mutation error codes to brand-aware copy", () => {
    expect(bindErrorCopy("BAD_REQUEST", BRAND).terminal).toBe(true);
    expect(bindErrorCopy("CONFLICT", BRAND).terminal).toBe(true);
    expect(bindErrorCopy("CONFLICT", BRAND).hint).toContain(`/${BRAND} unbind`);
    expect(bindErrorCopy("NOT_FOUND", BRAND).terminal).toBe(false);
    expect(bindErrorCopy(undefined, BRAND).terminal).toBe(false);
  });

  it("maps callback error codes to terminal copy that names the brand command", () => {
    for (const code of ["denied", "expired", "exchange_failed"]) {
      const copy = callbackErrorCopy(code, BRAND);
      expect(copy.terminal).toBe(true);
      expect(copy.hint).toContain(`/${BRAND} bind`);
    }
  });
});

describe("slack bind route", () => {
  it("round-trips /slack/bind", () => {
    expect(pathToState("/slack/bind")).toEqual({ view: "slack-bind" });
    expect(viewToPath("slack-bind")).toBe("/slack/bind");
  });
});
