import { describe, expect, it } from "vitest";

import { parseRoute, routeToPath } from "../../modules/platform/lib/routes.js";
import {
  bindErrorCopy,
  callbackErrorCopy,
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../../modules/telegram/lib/bind-flow.js";

const BRAND = "dam";

describe("telegram bind flow helpers", () => {
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

  it("maps bind mutation error codes to copy", () => {
    expect(bindErrorCopy("BAD_REQUEST", BRAND).terminal).toBe(true);
    expect(bindErrorCopy("CONFLICT", BRAND).terminal).toBe(true);
    expect(bindErrorCopy("CONFLICT", BRAND).hint).toContain(`/${BRAND} unbind`);
    expect(bindErrorCopy("NOT_FOUND", BRAND).terminal).toBe(false);
    expect(bindErrorCopy(undefined, BRAND).terminal).toBe(false);
  });

  it("maps callback error codes to terminal copy", () => {
    for (const code of ["denied", "expired", "exchange_failed"]) {
      expect(callbackErrorCopy(code, BRAND).terminal).toBe(true);
    }
  });
});

describe("telegram bind route", () => {
  it("round-trips /telegram/bind", () => {
    expect(parseRoute("/telegram/bind")).toEqual({ view: "telegram-bind" });
    expect(routeToPath({ view: "telegram-bind" })).toBe("/telegram/bind");
  });
});
