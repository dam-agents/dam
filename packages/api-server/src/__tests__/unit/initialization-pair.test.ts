// TEST_OVERVIEW: a kit's onboarding turn is queued before a new Agent has a saved default, so it names no model; each delivery gives it the saved default, holds it back while there is none, and leaves every other event as stored (#5578).
import { describe, expect, it, vi } from "vitest";
import type { SessionPair } from "api-server-api";
import { createInitializationPairResolver } from "../../modules/harness-config/services/initialization-pair.js";
import { NoDefaultModelError } from "../../modules/harness-config/domain/no-default-model.js";

const AGENT = "agent-1";
const SAVED: SessionPair = {
  harness: "claude-code",
  provider: "conn-ibm",
  model: "ibm/aws/claude-opus-5-5",
};

const onboarding = (payload: Record<string, unknown> = {}) => ({
  id: `initialization:${AGENT}:1`,
  kind: "initialization" as const,
  payload: { task: "Set yourself up.", ...payload },
});

function resolver(
  firePair: (
    agentId: string,
    preferred: { harness?: string },
  ) => Promise<SessionPair | null | undefined>,
) {
  const log = vi.fn();
  return {
    resolve: createInitializationPairResolver({ firePair, log }),
    log,
  };
}

describe("an onboarding turn queued before the agent's default", () => {
  // TEST_SCENARIO: the turn was queued at apply with no model, and the default was saved at the agent's first hello; the next delivery sends the turn on that default.
  it("goes out on the default saved after it was queued", async () => {
    const firePair = vi.fn(async () => SAVED);
    const { resolve } = resolver(firePair);
    expect(await resolve(AGENT, onboarding())).toEqual(
      onboarding({
        harness: "claude-code",
        provider: "conn-ibm",
        model: "ibm/aws/claude-opus-5-5",
      }),
    );
    expect(firePair).toHaveBeenCalledWith(AGENT, {});
  });

  // TEST_SCENARIO: the turn names the kit's harness; the default is resolved for that harness, and the saved settings ride along.
  it("resolves the default on the harness the turn names", async () => {
    const firePair = vi.fn(async () => ({
      ...SAVED,
      settings: { effort: "high" },
    }));
    const { resolve } = resolver(firePair);
    const resolved = await resolve(
      AGENT,
      onboarding({ harness: "claude-code" }),
    );
    expect(firePair).toHaveBeenCalledWith(AGENT, { harness: "claude-code" });
    expect(resolved?.payload).toMatchObject({
      model: "ibm/aws/claude-opus-5-5",
      settings: { effort: "high" },
    });
  });

  // TEST_SCENARIO: the agent has said hello but its default has no model yet; the runtime would refuse the turn, so it is held back for a later delivery instead of being sent.
  it("is held back while the agent has no default model", async () => {
    const { resolve } = resolver(async () => {
      throw new NoDefaultModelError();
    });
    expect(await resolve(AGENT, onboarding())).toBeNull();
  });

  // TEST_SCENARIO: before the agent's first hello, or on a runtime from before the Model Router, there is no pair to resolve; the turn goes as it was queued, as it did before.
  it("goes as queued when no pair resolves", async () => {
    const { resolve } = resolver(async () => undefined);
    const turn = onboarding();
    expect(await resolve(AGENT, turn)).toBe(turn);
  });

  // TEST_SCENARIO: reading the default fails for another reason; the turn is sent as queued and the failure is logged, so a failed read never drops it.
  it("goes as queued when the default cannot be read", async () => {
    const { resolve, log } = resolver(async () => {
      throw new Error("database is down");
    });
    const turn = onboarding();
    expect(await resolve(AGENT, turn)).toBe(turn);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("database is down"),
    );
  });

  // TEST_SCENARIO: a turn that already names its model (a kit update on an agent with a default) and every other event kind pass untouched, and no default is read for them.
  it("leaves a turn with a model and other events alone", async () => {
    const firePair = vi.fn(async () => SAVED);
    const { resolve } = resolver(firePair);
    const named = onboarding({ model: "anthropic/claude-sonnet-5-5" });
    const seed = {
      id: `workspace-seed:${AGENT}:1`,
      kind: "workspace-seed",
      payload: { url: "https://example.com/kit.git" },
    };
    expect(await resolve(AGENT, named)).toBe(named);
    expect(await resolve(AGENT, seed)).toBe(seed);
    expect(firePair).not.toHaveBeenCalled();
  });
});
