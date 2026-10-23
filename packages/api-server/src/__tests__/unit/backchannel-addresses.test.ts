/**
 * TEST_OVERVIEW: An install in an Environment answers on two address sets:
 * its public addresses, and the backchannel the agent that installed it
 * reaches through the Environment Link. A request is served on the set its
 * host names. Keycloak names the issuer of the address a sign-in started on,
 * so the API accepts a token from either set's Keycloak address and the UI
 * is told the issuer of the set it was loaded from. Without a backchannel the
 * install has its public set alone, as before.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuth } from "../../apps/api-server/admission/auth.js";
import {
  createAddressSets,
  keycloakRealmUrl,
  type AddressSet,
} from "../../core/address-sets.js";

const PUBLIC: AddressSet = {
  uiBaseUrl: "https://app.example.com",
  keycloakExternalUrl: "https://keycloak.example.com",
  shareBaseUrl: "https://share.example.com",
  contentBaseUrl: "https://content.example.com",
};

const BACKCHANNEL: AddressSet = {
  uiBaseUrl: "http://localhost:4444",
  keycloakExternalUrl: "http://keycloak.localhost:4444",
  shareBaseUrl: "http://share.localhost:4444",
  contentBaseUrl: "http://content.localhost:4444",
};

describe("address sets", () => {
  /**
   * TEST_SCENARIO: The UI asks for its sign-in settings from the host it was
   * loaded from; the answer names that set's Keycloak, by host name alone,
   * whatever the port or the case.
   */
  it("serves a request on the set its host names", () => {
    const sets = createAddressSets(PUBLIC, BACKCHANNEL);
    expect(sets.forHost("localhost:4444")).toBe(BACKCHANNEL);
    expect(sets.forHost("SHARE.localhost")).toBe(BACKCHANNEL);
    expect(sets.forHost("app.example.com")).toBe(PUBLIC);
    expect(sets.forHost("share.example.com:443")).toBe(PUBLIC);
    expect(sets.all).toEqual([PUBLIC, BACKCHANNEL]);
  });

  /**
   * TEST_SCENARIO: A host no set names, such as an IP literal on a catch-all
   * rule or no host at all, is served on the public set.
   */
  it("serves an unknown or missing host on the public set", () => {
    const sets = createAddressSets(PUBLIC, BACKCHANNEL);
    expect(sets.forHost("127.0.0.1:4444")).toBe(PUBLIC);
    expect(sets.forHost(undefined)).toBe(PUBLIC);
  });

  /**
   * TEST_SCENARIO: With the backchannel off every host is the public set, so
   * the install behaves as one with a single address set.
   */
  it("has the public set alone without a backchannel", () => {
    const sets = createAddressSets(PUBLIC, null);
    expect(sets.all).toEqual([PUBLIC]);
    expect(sets.forHost("localhost:4444")).toBe(PUBLIC);
  });

  /**
   * TEST_SCENARIO: The set is chosen by host name, so a backchannel that
   * reuses a public host name on another port would be ambiguous; it is
   * refused at boot.
   */
  it("refuses a backchannel that reuses a public host name", () => {
    expect(() =>
      createAddressSets(PUBLIC, {
        ...BACKCHANNEL,
        shareBaseUrl: "http://share.example.com:4444",
      }),
    ).toThrow(/share\.example\.com/);
  });

  it("names the realm on a set's Keycloak address", () => {
    expect(keycloakRealmUrl(BACKCHANNEL, "platform")).toBe(
      "http://keycloak.localhost:4444/realms/platform",
    );
  });
});

describe("the API accepts a token from either address set", () => {
  let server: Server;
  let jwksUrl: string;
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "k1",
      alg: "RS256",
    };
    server = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    jwksUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/certs`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const mint = (issuer: string) =>
    new SignJWT({ preferred_username: "alice" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(issuer)
      .setAudience("platform-api")
      .setSubject("u1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  const authFor = (sets: ReturnType<typeof createAddressSets>) =>
    createAuth({
      issuers: sets.all.map((set) => keycloakRealmUrl(set, "platform")),
      jwksUrl,
      audience: "platform-api",
    });

  /**
   * TEST_SCENARIO: The agent signs in through the Environment Link and gets a
   * token naming the backchannel Keycloak; a reviewer's token names the
   * public one. The same install accepts both, and still refuses a token from
   * any other issuer.
   */
  it("accepts both issuers with a backchannel and no other", async () => {
    const auth = authFor(createAddressSets(PUBLIC, BACKCHANNEL));
    const viaLink = await auth.verify(
      await mint("http://keycloak.localhost:4444/realms/platform"),
    );
    expect(viaLink.user.sub).toBe("u1");
    const viaPublic = await auth.verify(
      await mint("https://keycloak.example.com/realms/platform"),
    );
    expect(viaPublic.user.sub).toBe("u1");
    await expect(
      auth.verify(await mint("https://evil.example.com/realms/platform")),
    ).rejects.toThrow();
  });

  /**
   * TEST_SCENARIO: With the backchannel off, a token naming a localhost
   * Keycloak is refused, as before the backchannel existed.
   */
  it("accepts the public issuer alone without a backchannel", async () => {
    const auth = authFor(createAddressSets(PUBLIC, null));
    await expect(
      auth.verify(await mint("https://keycloak.example.com/realms/platform")),
    ).resolves.toBeDefined();
    await expect(
      auth.verify(await mint("http://keycloak.localhost:4444/realms/platform")),
    ).rejects.toThrow();
  });
});
