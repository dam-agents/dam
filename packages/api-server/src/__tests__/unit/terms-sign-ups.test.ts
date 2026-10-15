// TEST_OVERVIEW: The signUps install value decides whether a user who has never accepted the Terms of Use may accept them and start. Open admits everyone; closed turns away only those new users, while a user with any earlier acceptance still accepts a new Terms version.
import { describe, expect, it } from "vitest";
import type { AcceptedAcceptance, ApiContext, SignUps } from "api-server-api";
import { appRouter } from "api-server-api/router";
import type { TermsAcceptancesRepository } from "../../modules/terms/infrastructure/terms-acceptances-repository.js";
import { createTermsService } from "../../modules/terms/services/terms-service.js";

function setup(signUps: SignUps, acceptedVersions: string[] = []) {
  const rows: (AcceptedAcceptance & { sub: string })[] = acceptedVersions.map(
    (version) => ({
      sub: "user-1",
      version,
      hash: "h",
      acceptedAt: new Date(),
    }),
  );
  const find = (sub: string, version?: string) =>
    rows.find((r) => r.sub === sub && (!version || r.version === version)) ??
    null;
  const repo: TermsAcceptancesRepository = {
    recordAcceptance: async (sub, version, hash) => {
      rows.push({ sub, version, hash, acceptedAt: new Date() });
    },
    findLatest: async (sub) => find(sub),
    findForVersion: async (sub, version) => find(sub, version),
  };
  const terms = createTermsService({
    current: { version: "v2", text: "t", hash: "h2" },
    repo,
    signUps,
  });
  const ctx = {
    terms,
    user: { sub: "user-1", preferredUsername: "u", scopes: [], agentIds: "*" },
  } as unknown as ApiContext;
  return { caller: appRouter.createCaller(ctx), terms };
}

describe("terms.accept under the signUps value", () => {
  it("admits a first-time user when sign-ups are open", async () => {
    const { caller, terms } = setup("open");
    await caller.terms.accept({ version: "v2" });
    expect(await terms.isAccepted("user-1")).toBe(true);
  });

  // TEST_SCENARIO: The kill switch — a user with no acceptance on record is refused with FORBIDDEN and a message the Terms page shows, and nothing is recorded, so the Terms gate keeps them out of every other route.
  it("turns a first-time user away when sign-ups are closed", async () => {
    const { caller, terms } = setup("closed");
    await expect(caller.terms.accept({ version: "v2" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/sign-ups are closed/i),
    });
    expect(await terms.isAccepted("user-1")).toBe(false);
  });

  // TEST_SCENARIO: Closing sign-ups must not lock out existing users when a Terms version bump makes them accept again.
  it("lets an existing user re-accept a new version when sign-ups are closed", async () => {
    const { caller, terms } = setup("closed", ["v1"]);
    await caller.terms.accept({ version: "v2" });
    expect(await terms.isAccepted("user-1")).toBe(true);
  });
});
