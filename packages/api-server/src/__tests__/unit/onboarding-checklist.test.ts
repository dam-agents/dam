import type { Agent, OnboardingStep } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  completeStep,
  duplicateStepId,
  replaceChecklist,
} from "../../modules/starter-kits/domain/onboarding-checklist.js";
import type { OnboardingChecklistRepository } from "../../modules/starter-kits/infrastructure/onboarding-checklist-repository.js";
import { createOnboardingChecklist } from "../../modules/starter-kits/services/onboarding-checklist.js";

// TEST_OVERVIEW: the onboarding checklist is the agent's own report — replacing
// TEST_OVERVIEW: it keeps ticks on surviving steps, ticking is by id, and only a kit
// TEST_OVERVIEW: agent whose onboarding is still pending may write one.

const STEPS: OnboardingStep[] = [
  { id: "repo", label: "Name the repository", done: true },
  { id: "github", label: "Connect GitHub", done: false },
];

describe("onboarding checklist domain", () => {
  it("keeps the tick on a step that survives a replace, by id", () => {
    const next = replaceChecklist(STEPS, [
      { id: "github", label: "Connect GitHub as a bot" },
      { id: "repo", label: "Name the repository" },
      { id: "first-run", label: "Run the first review" },
    ]);
    expect(next).toEqual([
      { id: "github", label: "Connect GitHub as a bot", done: false },
      { id: "repo", label: "Name the repository", done: true },
      { id: "first-run", label: "Run the first review", done: false },
    ]);
    expect(replaceChecklist(null, [{ id: "a", label: "A" }])).toEqual([
      { id: "a", label: "A", done: false },
    ]);
  });

  it("ticks by id, idempotently, and refuses an unknown step", () => {
    const ticked = completeStep(STEPS, "github");
    expect(ticked?.map((s) => s.done)).toEqual([true, true]);
    expect(completeStep(ticked!, "github")).toEqual(ticked);
    expect(completeStep(STEPS, "nope")).toBeNull();
  });

  it("names a duplicated id", () => {
    expect(
      duplicateStepId([
        { id: "a", label: "A" },
        { id: "a", label: "B" },
      ]),
    ).toBe("a");
    expect(duplicateStepId([{ id: "a", label: "A" }])).toBeNull();
  });
});

function fakeRepo(initial: OnboardingStep[] | null = null) {
  const stored = new Map<string, OnboardingStep[]>();
  if (initial) stored.set("agent-1", initial);
  const repo: OnboardingChecklistRepository = {
    read: async (id) => stored.get(id) ?? null,
    readMany: async (ids) =>
      new Map(
        ids.flatMap((id) => (stored.has(id) ? [[id, stored.get(id)!]] : [])),
      ),
    write: async (id, steps) => {
      stored.set(id, steps);
    },
  };
  return { repo, stored };
}

function fakeAgents(agent: Partial<Agent> | null) {
  return {
    get: async () => (agent ? (agent as Agent) : null),
  };
}

describe("onboarding checklist service", () => {
  it("writes the list for a kit agent whose onboarding is pending", async () => {
    const { repo, stored } = fakeRepo();
    const checklist = createOnboardingChecklist({
      agents: fakeAgents({
        id: "agent-1",
        starterKit: "platform/code-reviewer@abc",
      }),
      repo,
    });
    await checklist.set("agent-1", [{ id: "github", label: "Connect GitHub" }]);
    const ticked = await checklist.complete("agent-1", "github");
    expect(ticked).toEqual([
      { id: "github", label: "Connect GitHub", done: true },
    ]);
    expect(stored.get("agent-1")).toEqual(ticked);
  });

  it("refuses a plain agent, a finished onboarding, a duplicate id and an unknown step", async () => {
    const plain = createOnboardingChecklist({
      agents: fakeAgents({ id: "agent-1" }),
      repo: fakeRepo().repo,
    });
    await expect(
      plain.set("agent-1", [{ id: "a", label: "A" }]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const finished = createOnboardingChecklist({
      agents: fakeAgents({
        id: "agent-1",
        starterKit: "platform/code-reviewer@abc",
        starterKitOnboarded: "2026-09-17T08:00:00.000Z",
      }),
      repo: fakeRepo().repo,
    });
    await expect(finished.complete("agent-1", "a")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    const pending = createOnboardingChecklist({
      agents: fakeAgents({
        id: "agent-1",
        starterKit: "platform/code-reviewer@abc",
      }),
      repo: fakeRepo(STEPS).repo,
    });
    await expect(
      pending.set("agent-1", [
        { id: "a", label: "A" },
        { id: "a", label: "B" },
      ]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(pending.complete("agent-1", "nope")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
