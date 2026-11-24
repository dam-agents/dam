// TEST_OVERVIEW: A relay upgrade carries its credential in `Authorization: Bearer` or in the `token` query parameter, and the header wins. The CLI inside an Agent holds only a placeholder, which it sends in both places; the Agent's gateway puts the real key in the header alone, so the relay must read the header to admit `dam run`, `dam chat` and `dam ssh` from there. A browser cannot set the header and keeps working on the query parameter.
import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import {
  createRelayAdmission,
  upgradeToken,
} from "../../apps/api-server/agent-proxies/upgrade.js";

const PLACEHOLDER = "platform:conn:conn-dam";
const REAL_KEY = "dam_owner_key";

const request = (headers: IncomingMessage["headers"]) =>
  ({ headers, socket: {} }) as IncomingMessage;

const url = (query: string) => new URL(`http://x/api/agents/bot/acp${query}`);

function admission() {
  return createRelayAdmission({
    authenticate: async (token) =>
      token === REAL_KEY
        ? ({
            ok: true,
            principal: {
              user: {
                sub: "alice",
                preferredUsername: "alice",
                scopes: ["agents:operate"],
                agentIds: "*",
                keyId: "key-1",
              },
              azp: "platform-ui",
              roles: [],
            },
          } as never)
        : { ok: false, kind: "unauthorized" },
    standingOf: async () => ({ role: "owner" }),
    editorSockets: { track: () => {}, close: () => {} },
    isTermsAccepted: async () => true,
    surfaceAttribution: { uiClientId: "platform-ui", cliClientId: "cli" },
  });
}

describe("the credential of a relay upgrade", () => {
  // TEST_SCENARIO: The CLI in an Agent sends the placeholder in the query and in the header, and the gateway overwrites the header with the owner's key. The relay admits it as the owner: before, it read only the query and refused the placeholder.
  it("admits the key the gateway put in the header over a placeholder in the query", async () => {
    const admitted = await admission()(
      request({ authorization: `Bearer ${REAL_KEY}` }),
      url(`?token=${encodeURIComponent(PLACEHOLDER)}`),
      "bot",
      { kind: "acp", permission: "sessions" },
    );
    expect(admitted).toMatchObject({ ok: true, user: { sub: "alice" } });
  });

  // TEST_SCENARIO: A browser cannot set a header on a WebSocket, so a token in the query alone still admits.
  it("reads the query parameter when no bearer header is sent", () => {
    expect(upgradeToken(request({}), url("?token=abc"))).toBe("abc");
  });

  // TEST_SCENARIO: A header that is not a bearer credential is no credential: the query parameter is read instead, and with neither there is none.
  it("ignores an Authorization header that is not a bearer", () => {
    expect(
      upgradeToken(request({ authorization: "Basic xyz" }), url("?token=abc")),
    ).toBe("abc");
    expect(upgradeToken(request({ authorization: "Basic xyz" }), url(""))).toBe(
      null,
    );
  });
});
