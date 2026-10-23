import { describe, expect, it } from "vitest";

import {
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../../modules/agents/components/bind/bind-flow.js";
import {
  bindErrorCopy as slackBindErrorCopy,
  callbackErrorCopy as slackCallbackErrorCopy,
} from "../../modules/slack/lib/bind-flow.js";
import {
  bindErrorCopy as telegramBindErrorCopy,
  callbackErrorCopy as telegramCallbackErrorCopy,
} from "../../modules/telegram/lib/bind-flow.js";

const BRAND = "acme";

describe("a chat bind page's search string", () => {
  it("reads the flow id from the search string", () => {
    expect(readFlowIdFromSearch("?flow=abc-123")).toBe("abc-123");
    expect(readFlowIdFromSearch("?flow=abc&x=1")).toBe("abc");
    expect(readFlowIdFromSearch("?x=1")).toBe(null);
    expect(readFlowIdFromSearch("?flow=")).toBe(null);
    expect(readFlowIdFromSearch("")).toBe(null);
  });

  it("reads the callback error from the search string", () => {
    expect(readCallbackErrorFromSearch("?error=denied")).toBe("denied");
    expect(readCallbackErrorFromSearch("?x=1")).toBe(null);
  });
});

describe("slack bind error copy", () => {
  it("maps bind mutation error codes to brand-aware copy", () => {
    expect(slackBindErrorCopy("BAD_REQUEST", BRAND).terminal).toBe(true);
    expect(slackBindErrorCopy("CONFLICT", BRAND).terminal).toBe(false);
    expect(slackBindErrorCopy("CONFLICT", BRAND).hint).toContain(
      "Pick a different agent",
    );
    expect(slackBindErrorCopy("NOT_FOUND", BRAND).terminal).toBe(false);
    expect(slackBindErrorCopy("UNPROCESSABLE_CONTENT", BRAND).terminal).toBe(
      true,
    );
    expect(slackBindErrorCopy("UNPROCESSABLE_CONTENT", BRAND).hint).toContain(
      `/${BRAND} bind`,
    );
    expect(slackBindErrorCopy("SERVICE_UNAVAILABLE", BRAND).terminal).toBe(
      false,
    );
    expect(slackBindErrorCopy(undefined, BRAND).terminal).toBe(false);
  });

  it("maps callback error codes to terminal copy that names the brand command", () => {
    for (const code of ["denied", "expired", "exchange_failed"]) {
      const copy = slackCallbackErrorCopy(code, BRAND);
      expect(copy.terminal).toBe(true);
      expect(copy.hint).toContain(`/${BRAND} bind`);
    }
  });
});

describe("telegram bind error copy", () => {
  it("maps bind mutation error codes to copy", () => {
    expect(telegramBindErrorCopy("BAD_REQUEST").terminal).toBe(true);
    expect(telegramBindErrorCopy("CONFLICT").terminal).toBe(true);
    expect(telegramBindErrorCopy("CONFLICT").hint).toContain("`/unbind`");
    expect(telegramBindErrorCopy("NOT_FOUND").terminal).toBe(false);
    expect(telegramBindErrorCopy(undefined).terminal).toBe(false);
  });

  it("maps callback error codes to terminal copy", () => {
    for (const code of ["denied", "expired", "exchange_failed"]) {
      expect(telegramCallbackErrorCopy(code).terminal).toBe(true);
    }
  });
});
