// TEST_OVERVIEW: the install's Access List, which Keycloak checks at each sign-in. Only an operator lists, adds or removes addresses, and an add stores each address lowercased once. Keycloak's check answers whether an address is on the list only for a call that carries the install's shared secret, and answers 503 when the list cannot be read, so a database outage refuses a sign-in as unavailable rather than as not allowed. The chart's seed is a JSON array of emails, and a malformed one stops the boot.
import { describe, expect, it, vi } from "vitest";
import type { AccessList, ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { createAccessCheckRoutes } from "../../apps/api-server/routes/access-check.js";
import {
  bearerMatches,
  parseAccessListSeed,
} from "../../modules/access-list/index.js";
import { callerContext } from "../helpers/caller-context.js";

const EMPTY: AccessList = { enabled: true, entries: [] };

function setup(isOperator: boolean) {
  const accessList = {
    list: vi.fn(async () => EMPTY),
    add: vi.fn(async () => EMPTY),
    remove: vi.fn(async () => EMPTY),
  };
  const ctx = callerContext({
    accessList,
    user: {
      sub: "user-1",
      preferredUsername: "user",
      scopes: [],
      agentIds: "*",
      isOperator,
    } satisfies ApiContext["user"],
  });
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), accessList };
}

describe("who manages the Access List", () => {
  // TEST_SCENARIO: a person without the operator role can neither read nor change the list, and the service is never reached.
  it("refuses a person who is not an operator", async () => {
    const { caller, accessList } = setup(false);
    await expect(caller.accessList.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.accessList.add({ emails: ["ada@example.com"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.accessList.remove({ email: "ada@example.com" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(accessList.list).not.toHaveBeenCalled();
    expect(accessList.add).not.toHaveBeenCalled();
    expect(accessList.remove).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: an operator's add reaches the service with each address trimmed, lowercased and once, so `Ada@Example.com` and `ada@example.com` are one entry.
  it("lets an operator add addresses, normalized", async () => {
    const { caller, accessList } = setup(true);
    await caller.accessList.add({
      emails: [" Ada@Example.com", "ada@example.com", "bob@example.com"],
    });
    expect(accessList.add).toHaveBeenCalledWith({
      emails: ["ada@example.com", "bob@example.com"],
    });
  });

  // TEST_SCENARIO: an operator's add refuses a string that is not an email address before the service is reached.
  it("refuses an address that is not an email", async () => {
    const { caller, accessList } = setup(true);
    await expect(
      caller.accessList.add({ emails: ["not-an-email"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(accessList.add).not.toHaveBeenCalled();
  });
});

describe("Keycloak's access check", () => {
  const SECRET = "s3cret-value";
  function check(
    allows: (email: string) => Promise<boolean>,
    init: { auth?: string; body?: unknown },
  ) {
    const routes = createAccessCheckRoutes({ secret: SECRET, allows });
    return routes.request("/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init.auth ? { Authorization: init.auth } : {}),
      },
      body: JSON.stringify(init.body ?? { email: "ada@example.com" }),
    });
  }

  // TEST_SCENARIO: a call with the shared secret learns whether the address is on the list.
  it("answers whether the address is allowed", async () => {
    const allows = vi.fn(async (email: string) => email === "ada@example.com");
    const yes = await check(allows, { auth: `Bearer ${SECRET}` });
    expect(yes.status).toBe(200);
    expect(await yes.json()).toEqual({ allowed: true });
    const no = await check(allows, {
      auth: `Bearer ${SECRET}`,
      body: { email: "eve@example.com" },
    });
    expect(await no.json()).toEqual({ allowed: false });
  });

  // TEST_SCENARIO: a call without the secret, or with another one, is refused before the list is read, so nobody else can probe who may sign in.
  it("refuses a call without the shared secret", async () => {
    const allows = vi.fn(async () => true);
    expect((await check(allows, {})).status).toBe(401);
    expect((await check(allows, { auth: "Bearer wrong-value!" })).status).toBe(
      401,
    );
    expect(allows).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: when the list cannot be read the check answers 503, which Keycloak shows as sign-in unavailable, never as not allowed.
  it("answers 503 when the list cannot be read", async () => {
    const res = await check(
      async () => {
        throw new Error("db down");
      },
      { auth: `Bearer ${SECRET}` },
    );
    expect(res.status).toBe(503);
  });

  // TEST_SCENARIO: an install with no secret set refuses every call, so the check never runs open.
  it("matches no bearer when no secret is set", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer anything", "")).toBe(false);
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(true);
  });
});

describe("the chart's seed", () => {
  // TEST_SCENARIO: the seed is a JSON array of emails, read lowercased and without repeats; an empty value seeds nothing.
  it("reads the seed's emails", () => {
    expect(parseAccessListSeed("")).toEqual([]);
    expect(parseAccessListSeed(undefined)).toEqual([]);
    expect(
      parseAccessListSeed('["Ada@Example.com", "ada@example.com", "b@x.io"]'),
    ).toEqual(["ada@example.com", "b@x.io"]);
  });

  // TEST_SCENARIO: a seed that is not JSON, or holds a string that is not an email, stops the boot instead of seeding a short list.
  it("refuses a malformed seed", () => {
    expect(() => parseAccessListSeed("ada@example.com")).toThrow(
      /ACCESS_LIST_SEED/,
    );
    expect(() => parseAccessListSeed('["not-an-email"]')).toThrow();
  });
});
