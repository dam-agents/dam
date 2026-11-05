// TEST_OVERVIEW: Provisioning a retried create binds the owner's Default profile as the assistant's chat default — whichever Default the install has, since the bind names no harness, model or provider — and that binding is only ever taken while the slot is empty. A person who switched the assistant to another profile keeps it, and an install where no Default can be resolved yet binds nothing, leaving the slot for the default-model conversion to fill later.
import { describe, expect, it } from "vitest";
import type { HarnessCatalog } from "api-server-api";
import type { ProfilesRepository } from "../../modules/profiles/infrastructure/profiles-repository.js";
import { bindDefaultProfile } from "../../modules/profiles/services/profiles-service.js";

const OWNER = "owner-1";
const ASSISTANT = "agent-00000000000000a1";

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const profile = (id: string, providerTemplate = "curve-bender-deployment") =>
  ({ id, name: id, providerTemplate }) as never;

/** UNIT_BOUNDARY_DESCRIPTION: the profiles table as `bindChatProfile` writes it — the row is filled only while no chat default and no saved pair is there, so a later choice of the person's is never overwritten. The agent holds whatever provider the install's Default names. */
function world(opts: { holdsConnection: boolean; template?: string }) {
  const template = opts.template ?? "curve-bender-deployment";
  const agent = { profile: null as string | null, pair: null as string | null };
  const repo = unused<ProfilesRepository>({
    agentConnections: async () =>
      opts.holdsConnection
        ? [{ templateId: template }]
        : [{ templateId: "anthropic" }],
    bindChatProfile: async (
      _owner: string,
      _agentId: string,
      profileId: string,
    ) => {
      if (agent.profile !== null || agent.pair !== null) return false;
      agent.profile = profileId;
      return true;
    },
  } as never);
  return {
    agent,
    deps: {
      repo,
      owner: OWNER,
      catalog: {
        default: "claude-code",
        harnesses: [],
      } as unknown as HarnessCatalog,
      seed: null,
    },
  };
}

describe("binding the Default profile to the assistant", () => {
  // TEST_SCENARIO: the retry of a partial create binds again; a person who switched the assistant to another profile in between keeps theirs, and the retry says why it did not bind.
  it("never overwrites a profile the person chose since", async () => {
    const w = world({ holdsConnection: true });
    expect(
      await bindDefaultProfile(w.deps, ASSISTANT, profile("p1")),
    ).toBeNull();
    expect(w.agent.profile).toBe("p1");

    // TEST_SCENARIO: the person switches the assistant to another profile.
    w.agent.profile = "p2";
    expect(await bindDefaultProfile(w.deps, ASSISTANT, profile("p1"))).toBe(
      "the agent already holds a chat default",
    );
    expect(w.agent.profile).toBe("p2");
  });

  // TEST_SCENARIO: the bind names no harness, model or provider of its own: it binds whichever Default the install has, and only asks that its provider be granted. A Default on any other provider template binds the same way, which is what lets the seeded Default change without touching the assistant.
  it("binds whatever Default the install has", async () => {
    const w = world({ holdsConnection: true, template: "anthropic" });
    expect(
      await bindDefaultProfile(w.deps, ASSISTANT, profile("p1", "anthropic")),
    ).toBeNull();
    expect(w.agent.profile).toBe("p1");
  });

  // TEST_SCENARIO: an install where the owner's Default runs on a provider the assistant does not hold binds nothing and says why, so the slot stays free for the conversion to fill once a provider answers.
  it("binds nothing when the Default's provider is not granted", async () => {
    const w = world({ holdsConnection: false });
    expect(await bindDefaultProfile(w.deps, ASSISTANT, profile("p1"))).toBe(
      "the agent holds no curve-bender-deployment Connection",
    );
    expect(w.agent.profile).toBeNull();
  });
});
