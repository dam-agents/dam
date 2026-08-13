import type { ConnectionView } from "api-server-api";
import { describe, expect, test } from "vitest";

import { bobPinsFromConnection } from "../../modules/providers/components/provider-item.js";

type Contributions = Pick<ConnectionView, "contributions">;

const withMode = (mode: string): Contributions => ({
  contributions: [{ kind: "env", name: "BOB_CHAT_MODE", placeholder: mode }],
});

describe("bobPinsFromConnection", () => {
  test.each(["code", "advanced"])("normalizes the retired %s mode", (mode) => {
    expect(bobPinsFromConnection(withMode(mode)).chatMode).toBe("agent");
  });

  test("leaves a current mode and an absent pin alone", () => {
    expect(bobPinsFromConnection(withMode("plan")).chatMode).toBe("plan");
    expect(
      bobPinsFromConnection({ contributions: [] }).chatMode,
    ).toBeUndefined();
  });
});
