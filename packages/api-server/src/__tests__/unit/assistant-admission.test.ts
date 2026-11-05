// TEST_OVERVIEW: An assistant is provisioned only for a person the install has admitted: a person who has not accepted the Terms of Use, or whose acceptance a closed sign-up refuses, gets none, and the provisioning call does nothing for them. Both flows that hand a person their first assistant without the context being made again — accepting the Terms of Use, and switching the assistant on in Experimental features — ask for it explicitly, over whichever transport the caller is on.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { createAssistantProvisioner } from "../../modules/assistants/services/assistant-provisioner.js";
import type { AssistantsRepository } from "../../modules/assistants/infrastructure/assistants-repository.js";

const OWNER = "alice";
const BRAND = "DAM";

const person = (): UserIdentity => ({
  sub: OWNER,
  preferredUsername: OWNER,
  scopes: ["agents:manage", "agents:operate"],
  agentIds: "*",
  email: "alice@example.com",
  emailVerified: true,
});

const VERSION = "2026-01-01";

function world(opts: { accepted?: boolean; signUpsOpen?: boolean } = {}) {
  const provisionAssistant = vi.fn(async () => undefined);
  const removeAssistant = vi.fn(async () => undefined);
  const accept = vi.fn(async () =>
    (opts.signUpsOpen ?? true)
      ? { ok: true as const, value: undefined }
      : { ok: false as const, error: { type: "SignUpsClosed" as const } },
  );
  const ctx = {
    user: person(),
    provisionAssistant,
    removeAssistant,
    terms: {
      current: () => ({ version: VERSION, text: "terms", hash: "hash" }),
      latestAcceptance: async () =>
        opts.accepted ? { version: VERSION } : null,
      accept,
    },
    features: {
      flags: async () => ({ assistant: false }),
      setFlag: vi.fn(async (_feature: string, enabled: boolean) => ({
        assistant: enabled,
      })),
    },
  } as unknown as ApiContext;
  markTermsProven(ctx);
  return {
    caller: appRouter.createCaller(ctx),
    provisionAssistant,
    removeAssistant,
    accept,
  };
}

describe("handing a person their assistant without a new context", () => {
  // TEST_SCENARIO: accepting the Terms of Use is what admits a person, so the acceptance itself provisions; one whose sign-up is closed is refused and provisions nothing.
  it("provisions after a successful acceptance, and not after a refused one", async () => {
    const open = world({ signUpsOpen: true });
    await open.caller.terms.accept({ version: VERSION });
    expect(open.provisionAssistant).toHaveBeenCalledTimes(1);

    const closed = world({ signUpsOpen: false });
    await expect(
      closed.caller.terms.accept({ version: VERSION }),
    ).rejects.toThrow(/Sign-ups are closed/);
    expect(closed.provisionAssistant).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: switching the assistant off deletes it, so the flag change is what runs the removal; switching it on provisions, and any other feature's switch does neither. An install's mode changing is not a flag change, so it deletes nothing.
  it("deletes the assistant only when the person switches it off", async () => {
    const off = world();
    await off.caller.features.setFlag({
      feature: "dambledore",
      enabled: false,
    });
    expect(off.removeAssistant).toHaveBeenCalledTimes(1);
    expect(off.provisionAssistant).not.toHaveBeenCalled();

    const on = world();
    await on.caller.features.setFlag({ feature: "dambledore", enabled: true });
    expect(on.provisionAssistant).toHaveBeenCalledTimes(1);
    expect(on.removeAssistant).not.toHaveBeenCalled();

    const other = world();
    await other.caller.features.setFlag({ feature: "hermes", enabled: false });
    expect(other.removeAssistant).not.toHaveBeenCalled();
    expect(other.provisionAssistant).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a stale acceptance is refused before anything is stored, so it provisions nothing either.
  it("provisions nothing for a stale acceptance", async () => {
    const w = world();
    await expect(w.caller.terms.accept({ version: "older" })).rejects.toThrow(
      /terms_stale/,
    );
    expect(w.provisionAssistant).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: switching the assistant on in Experimental features provisions it at once, because the caller's context is not made again; switching another feature or switching it off does not.
  it("provisions when the experimental switch is turned on", async () => {
    const on = world();
    await on.caller.features.setFlag({ feature: "dambledore", enabled: true });
    expect(on.provisionAssistant).toHaveBeenCalledTimes(1);

    const off = world();
    await off.caller.features.setFlag({
      feature: "dambledore",
      enabled: false,
    });
    await off.caller.features.setFlag({ feature: "hermes", enabled: true });
    expect(off.provisionAssistant).not.toHaveBeenCalled();
  });
});

describe("provisioning before admission", () => {
  // TEST_SCENARIO: a person who has not accepted the Terms of Use — or whose sign-up was refused — is not admitted, and provisioning creates nothing and records nothing for them.
  it("creates nothing for a person the install has not admitted", async () => {
    const rows = new Map<string, { owner: string; agentId: string }>();
    const create = vi.fn(async () => ({ id: "agent-derived" }) as never);
    const repo = {
      find: async (owner: string) => {
        const row = rows.get(owner);
        return row
          ? {
              ...row,
              incarnation: 1,
              state: "ready" as const,
              steps: [],
              used: false,
              renamed: null,
              noticeSeen: false,
            }
          : null;
      },
      start: async (owner: string, agentId: string) => {
        if (rows.has(owner)) return false;
        rows.set(owner, { owner, agentId });
        return true;
      },
      nextIncarnation: async () => false,
      markInitStep: async () => undefined,
      markReady: async () => undefined,
      recordRename: async () => undefined,
      completeRename: async () => undefined,
      clearRename: async () => undefined,
      markNoticeSeen: async () => undefined,
      resetUsed: async () => undefined,
      forgetAll: async () => undefined,
      markUsed: async () => undefined,
      forgetByAgent: async () => undefined,
      listAgentIds: async () => [],
    } satisfies AssistantsRepository;
    const provisioner = createAssistantProvisioner({
      repo,
      ownName: OWNER,
      assistantName: "Dambledore",
      brandName: BRAND,
      admitted: async () => false,
      enabled: async () => true,
      agentOf: async () => null,
      agents: {
        list: async () => [],
        create,
        update: async () => null,
      },
      enrolled: async () => undefined,
      provisioned: async () => undefined,
      withLock: (_owner, work) =>
        work().then((value) => ({ ran: true as const, value })),
    });

    await provisioner.ensure();
    expect(create).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });
});
