// TEST_OVERVIEW: The owner catalog hides a harness whose feature the owner does not have on, so the Settings› Providers and Profiles pickers read the same list an agent's own status offers (docs/architecture/features.md).
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { callerContext } from "../helpers/caller-context.js";

const harness = (name: string) => ({
  name,
  harnessConfig: true,
  sessionModel: true,
});

const catalog = () => ({
  defaultHarness: "pi",
  modelRouter: true,
  harnesses: [harness("pi"), harness("hermes")],
  providers: [],
});

function setup(hermes: boolean) {
  const connections = {
    modelCatalog: vi.fn(async () => catalog()),
  };
  const features = { flags: vi.fn(async () => ({ hermes })) };
  const user = {
    sub: "owner-1",
    preferredUsername: "test",
    scopes: ["credentials:read", "agents:read"],
    agentIds: "*",
    keyId: "key-1",
  } as unknown as ApiContext["user"];
  const ctx = callerContext({ connections, features, user });
  markTermsProven(ctx);
  return appRouter.createCaller(ctx);
}

describe("the owner catalog's harnesses", () => {
  /** TEST_SCENARIO: The Hermes harness is left out of the owner catalog while its feature is off, and is offered while the owner has it on. */
  it("leaves out a harness whose feature is off", async () => {
    const names = async (hermes: boolean) =>
      (await setup(hermes).connections.catalog()).harnesses.map((h) => h.name);
    expect(await names(false)).toEqual(["pi"]);
    expect(await names(true)).toEqual(["pi", "hermes"]);
  });
});
