// TEST_OVERVIEW: an agent's conversations, its memory and its checkout are files on a volume, and the release this migrates from kept them on several — one per declared mount — where a node keeps one. Getting the merge wrong is the quietest possible failure: the agent starts, and its history is simply not there.
import { describe, expect, it } from "vitest";
import { planWorkspace } from "../../modules/migration/domain/workspace-plan.js";

const home = "/home/agent";

describe("planning where an agent's volumes go", () => {
  it("puts the home at the root and a work tree inside it", () => {
    const plan = planWorkspace(home, [
      { claimName: "pvc-work", path: "/home/agent/work" },
      { claimName: "pvc-home", path: "/home/agent" },
    ]);
    expect(plan.moves).toEqual([
      { claimName: "pvc-home", destination: "" },
      { claimName: "pvc-work", destination: "work" },
    ]);
    expect(plan.unplaceable).toEqual([]);
  });

  // TEST_SCENARIO: the home has to be restored before anything that lands inside it, or extracting it afterwards buries what was already put there.
  it("restores the home before what sits inside it, whatever order they arrive in", () => {
    const plan = planWorkspace(home, [
      { claimName: "deep", path: "/home/agent/work/nested" },
      { claimName: "work", path: "/home/agent/work" },
      { claimName: "home", path: "/home/agent/" },
    ]);
    expect(plan.moves.map((m) => m.destination)).toEqual([
      "",
      "work",
      "work/nested",
    ]);
  });

  // TEST_SCENARIO: a volume mounted outside the home has nowhere to go on a node. Saying so is the whole point — an agent whose data silently did not arrive looks exactly like one that never had any.
  it("reports a volume it cannot place rather than guessing", () => {
    const plan = planWorkspace(home, [
      { claimName: "home", path: "/home/agent" },
      { claimName: "scratch", path: "/mnt/scratch" },
    ]);
    expect(plan.moves).toHaveLength(1);
    expect(plan.unplaceable).toEqual([
      { claimName: "scratch", path: "/mnt/scratch" },
    ]);
  });

  it("is not fooled by a path that merely starts with the home's name", () => {
    const plan = planWorkspace(home, [
      { claimName: "other", path: "/home/agentic" },
    ]);
    expect(plan.moves).toEqual([]);
    expect(plan.unplaceable).toHaveLength(1);
  });
});
