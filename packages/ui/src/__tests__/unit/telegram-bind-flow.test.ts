import { describe, expect, it } from "vitest";

import {
  bindErrorCopy,
  callbackErrorCopy,
  readFlowIdFromSearch,
} from "../../modules/telegram/lib/bind-flow.js";

describe("telegram bind flow helpers", () => {
  it("reads the flow id from the search string", () => {
    expect(readFlowIdFromSearch("?flow=abc-123")).toBe("abc-123");
    expect(readFlowIdFromSearch("?flow=abc&x=1")).toBe("abc");
    expect(readFlowIdFromSearch("?x=1")).toBe(null);
    expect(readFlowIdFromSearch("?flow=")).toBe(null);
    expect(readFlowIdFromSearch("")).toBe(null);
  });

  it("maps bind mutation error codes to copy", () => {
    expect(bindErrorCopy("BAD_REQUEST").terminal).toBe(true);
    expect(bindErrorCopy("CONFLICT").terminal).toBe(true);
    expect(bindErrorCopy("CONFLICT").hint).toContain("`/unbind`");
    expect(bindErrorCopy("NOT_FOUND").terminal).toBe(false);
    expect(bindErrorCopy(undefined).terminal).toBe(false);
  });

  it("maps callback error codes to terminal copy", () => {
    for (const code of ["denied", "expired", "exchange_failed"]) {
      expect(callbackErrorCopy(code).terminal).toBe(true);
    }
  });
});
