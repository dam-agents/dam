import { AUTH_ERROR_HINT } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  describeSendError,
  extractErrorMessage,
} from "../../modules/acp/errors.js";

describe("send-error surfacing", () => {
  test("a rejected key names the providers settings as the place to fix it", () => {
    const { hint } = describeSendError(
      "API error: 401 Unauthorized: Invalid API key",
    );
    expect(hint).toBe(AUTH_ERROR_HINT);
    expect(hint).toMatch(/Settings › Providers/);
    expect(hint).not.toMatch(/Secrets/);
  });

  test("an error that already carries the auth hint gets no second hint", () => {
    const raw = `${AUTH_ERROR_HINT}\n\nError: API error: 401 authentication_error`;
    expect(describeSendError(raw)).toEqual({ message: raw });
  });

  test("JSON-RPC internal error is replaced by data.details", () => {
    expect(
      extractErrorMessage({
        code: -32603,
        message: "Internal error",
        data: { details: "API error: 402 Payment Required" },
      }),
    ).toBe("API error: 402 Payment Required");
  });

  test("billing failures get an actionable hint", () => {
    const { message, hint } = describeSendError(
      "API error: 402 Payment Required",
    );
    expect(message).toBe("API error: 402 Payment Required");
    expect(hint).toMatch(/billing/i);
  });

  test("bare internal error is rewritten to say where to look", () => {
    const { message, hint } = describeSendError("Internal error");
    expect(message).not.toMatch(/internal error/i);
    expect(hint).toMatch(/session log/i);
  });
});
