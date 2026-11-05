// TEST_OVERVIEW: "Reset user onboarding" starts this person's onboarding over and nobody else's: it forgets that their assistant was used — which is what brings the greeting and the first landing back — and resets their Get started checklist through the checklist's own reset. It deletes nothing, leaves the one-time rename news alone, succeeds for someone with no assistant yet, and is refused while the feature is off for them.
import { describe, expect, it, vi } from "vitest";
import type { AssistantsRepository } from "../../modules/assistants/infrastructure/assistants-repository.js";
import { createAssistantsService } from "../../modules/assistants/services/assistants-service.js";

const ALICE = "alice";
const BOB = "bob";

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

/** UNIT_BOUNDARY_DESCRIPTION: the assistants row of two people, so a reset can be shown to touch only the caller's. */
function world() {
  const used = new Map<string, boolean>([
    [ALICE, true],
    [BOB, true],
  ]);
  const repo = unused<AssistantsRepository>({
    find: async (owner: string) =>
      used.has(owner)
        ? {
            owner,
            incarnation: 1,
            agentId: "agent-00000000000000a1",
            state: "ready" as const,
            steps: [],
            used: used.get(owner) ?? false,
            renamed: {
              agentId: "agent-old",
              from: "Dambledore",
              to: "Dambledore (yours)",
              done: true,
            },
            noticeSeen: false,
          }
        : null,
    resetUsed: async (owner: string) => {
      used.set(owner, false);
    },
  });
  const resetChecklist = vi.fn(async () => undefined);
  const serviceFor = (owner: string, enabled = true) =>
    createAssistantsService({
      repo,
      owner,
      enabled: async () => enabled,
      resetChecklist,
    });
  return { serviceFor, used, resetChecklist };
}

describe("resetting one person's onboarding", () => {
  // TEST_SCENARIO: the caller asks for the reset: their assistant counts as unused again and their checklist starts over; another person's row is untouched.
  it("resets the caller's assistant and checklist, and nobody else's", async () => {
    const w = world();
    await w.serviceFor(ALICE).resetOnboarding();

    expect(w.used.get(ALICE)).toBe(false);
    expect(w.used.get(BOB)).toBe(true);
    expect(w.resetChecklist).toHaveBeenCalledTimes(1);
    expect((await w.serviceFor(ALICE).state())?.used).toBe(false);
  });

  // TEST_SCENARIO: nothing else about the row changes — the one-time rename news is still there to show, since the reset is not about it.
  it("keeps the rename news", async () => {
    const w = world();
    await w.serviceFor(ALICE).resetOnboarding();
    expect((await w.serviceFor(ALICE).state())?.notice).toEqual({
      renamedFrom: "Dambledore",
      renamedTo: "Dambledore (yours)",
    });
  });

  // TEST_SCENARIO: with the feature off for the person, the reset is refused and nothing is written or reset.
  it("is refused while the feature is off", async () => {
    const w = world();
    await expect(
      w.serviceFor(ALICE, false).resetOnboarding(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(w.used.get(ALICE)).toBe(true);
    expect(w.resetChecklist).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a person with no assistant yet still resets their checklist — the button is never a failure.
  it("succeeds for a person with no assistant", async () => {
    const w = world();
    await w.serviceFor("carol").resetOnboarding();
    expect(w.resetChecklist).toHaveBeenCalledTimes(1);
  });
});
