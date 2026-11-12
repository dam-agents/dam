// TEST_OVERVIEW: the boot step that removes the disabled mark a deleted feature left behind. Every Agent still marked is cleared once, an Agent the repository fails on does not stop the rest, and the count says what happened.
import { describe, expect, it } from "vitest";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { clearLegacyDisabledMarks } from "../../modules/agents/sagas/clear-legacy-disabled.js";

type Agent = { id: string; disabled: boolean };

function fakeRepo(agents: Agent[], failing: string[] = []) {
  const cleared: string[] = [];
  return {
    cleared,
    async list() {
      return agents as unknown as InfraAgent[];
    },
    async clearLegacyDisabled(id: string) {
      if (failing.includes(id)) throw new Error("store unavailable");
      cleared.push(id);
      return true;
    },
  };
}

describe("clearLegacyDisabledMarks", () => {
  // TEST_SCENARIO: only the Agents that still carry the mark are written, each once, and the count is what the boot log reports.
  it("clears every marked Agent once and counts them", async () => {
    const repo = fakeRepo([
      { id: "a1", disabled: true },
      { id: "a2", disabled: false },
      { id: "a3", disabled: true },
    ]);
    expect(await clearLegacyDisabledMarks(repo)).toBe(2);
    expect(repo.cleared).toEqual(["a1", "a3"]);
  });

  // TEST_SCENARIO: one Agent the store refuses to write must not cost the others their cleanup, and the next boot tries it again.
  it("carries on past an Agent whose write fails", async () => {
    const repo = fakeRepo(
      [
        { id: "a1", disabled: true },
        { id: "a2", disabled: true },
      ],
      ["a1"],
    );
    expect(await clearLegacyDisabledMarks(repo)).toBe(1);
    expect(repo.cleared).toEqual(["a2"]);
  });

  // TEST_SCENARIO: a fleet with nothing marked costs one listing and no writes.
  it("writes nothing when nothing is marked", async () => {
    const repo = fakeRepo([{ id: "a1", disabled: false }]);
    expect(await clearLegacyDisabledMarks(repo)).toBe(0);
    expect(repo.cleared).toEqual([]);
  });
});
