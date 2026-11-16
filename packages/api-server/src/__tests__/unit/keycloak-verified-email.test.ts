// TEST_OVERVIEW: The mailbox the DM Bridge pairs a Slack account with comes from Keycloak's admin API, and it is only good enough when Keycloak itself says the account is enabled and the address is verified. A record that leaves either flag out, types it as something else, carries an empty address, or an API that answers nothing usable is unknown, and unknown pairs nobody.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeycloakUserDirectory } from "../../modules/agents/infrastructure/keycloak-user-directory.js";

const directory = createKeycloakUserDirectory({
  keycloakUrl: "http://keycloak",
  keycloakRealm: "platform",
  clientId: "platform-api",
  clientSecret: "secret",
});

type Reply = { status: number; body: unknown };

function stubFetch(record: (url: string) => Reply) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/protocol/openid-connect/token"))
      return new Response(
        JSON.stringify({ access_token: "token", expires_in: 300 }),
        { status: 200 },
      );
    const reply = record(url);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the verified mailbox of an owner", () => {
  // TEST_SCENARIO: Keycloak says the account is enabled and the address verified, so the pairing may use it.
  it("answers a verified address on an enabled user", async () => {
    stubFetch(() => ({
      status: 200,
      body: {
        id: "sub-1",
        enabled: true,
        emailVerified: true,
        email: "owner@example.com",
      },
    }));
    expect(await directory.resolveVerifiedEmailBySub("sub-1")).toBe(
      "owner@example.com",
    );
  });

  // TEST_SCENARIO: either flag missing or false leaves the mailbox unusable, and an unknown enabled state is not an enabled one.
  it("refuses an account Keycloak does not call enabled and verified", async () => {
    const bodies = [
      { enabled: false, emailVerified: true, email: "owner@example.com" },
      { enabled: true, emailVerified: false, email: "owner@example.com" },
      { emailVerified: true, email: "owner@example.com" },
      { enabled: true, email: "owner@example.com" },
      { enabled: "true", emailVerified: true, email: "owner@example.com" },
      { enabled: true, emailVerified: "true", email: "owner@example.com" },
      { enabled: true, emailVerified: true, email: "" },
      { enabled: true, emailVerified: true, email: 42 },
      { enabled: true, emailVerified: true },
    ];
    for (const body of bodies) {
      stubFetch(() => ({ status: 200, body }));
      expect(
        await directory.resolveVerifiedEmailBySub("sub-1"),
        JSON.stringify(body),
      ).toBeNull();
      vi.unstubAllGlobals();
    }
  });

  // TEST_SCENARIO: an admin API that refuses, or an unreadable answer, is no mailbox at all.
  it("fails closed when the directory cannot answer", async () => {
    stubFetch(() => ({ status: 404, body: { error: "not found" } }));
    expect(await directory.resolveVerifiedEmailBySub("sub-1")).toBeNull();
    vi.unstubAllGlobals();

    stubFetch(() => ({ status: 200, body: "not a user" }));
    expect(await directory.resolveVerifiedEmailBySub("sub-1")).toBeNull();
    vi.unstubAllGlobals();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("directory down");
      }),
    );
    expect(await directory.resolveVerifiedEmailBySub("sub-1")).toBeNull();
  });
});
