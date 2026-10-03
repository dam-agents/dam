// TEST_OVERVIEW: Kit Update offers a newer definition when the stamped seed branch has moved, starts it as a pending session, and moves the Seed Stamp only for the commit the update targeted.
import { describe, expect, it } from "vitest";
import type { Agent, KitUpdatePending, SeedStamp } from "api-server-api";

import { changelogBetween } from "../../modules/starter-kits/domain/changelog-range.js";
import { createKitUpdateReporter } from "../../modules/starter-kits/services/kit-update-reporter.js";
import { createKitUpdates } from "../../modules/starter-kits/services/kit-updates.js";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const STAMP: SeedStamp = {
  url: "https://github.com/acme/guardian",
  commit: OLD,
};

function agent(extra: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "guardian",
    spec: { name: "guardian", image: "img" },
    state: "running",
    effectiveHibernationTimeoutMin: 30,
    stopRequested: false,
    overBudget: false,
    podRestarts: 0,
    contributionFailures: [],
    unsupportedContributionKinds: [],
    workspaceFailures: [],
    features: { liveUpdates: false },
    channels: [],
    starterKit: `curated/guardian@${OLD}`,
    starterKitOnboarded: "2026-10-01T00:00:00Z",
    starterKitSeed: STAMP,
    ...extra,
  };
}

function harness(current: Agent) {
  const marks: { begun?: KitUpdatePending; ended?: SeedStamp | null } = {};
  const bumped: string[] = [];
  const updates = createKitUpdates({
    owner: "user-1",
    repo: { get: async () => null },
    upstream: {
      head: async () => ({ status: "resolved", sha: NEW }),
      changes: async () => {
        throw new Error("unused");
      },
    },
    marks: {
      begin: async (_id, _stamp, pending) => {
        marks.begun = pending;
      },
      end: async (_id, stamp) => {
        marks.ended = stamp;
      },
      skip: async () => {},
    },
    agents: { list: async () => [current], get: async () => current },
    schedules: { list: async () => [] },
    grantedTemplates: async () => [],
    familyTitles: async () => new Map(),
    wakeAgent: async () => {},
    runtimeMutator: {
      bump: async (_id: string, events: { id: string }[]) => {
        bumped.push(...events.map((e) => e.id));
        return 1;
      },
      enqueueAfterCommit: async () => {},
    } as never,
    now: () => new Date("2026-10-02T10:00:00Z"),
  });
  return { updates, marks, bumped };
}

describe("kit update", () => {
  // TEST_SCENARIO: an onboarded agent whose seed branch moved is offered the update; one still onboarding, or one that skipped that head, is not.
  it("offers an update only once onboarding is done and the branch moved", async () => {
    const [ready] = await harness(agent()).updates.updates();
    expect(ready).toMatchObject({
      state: "available",
      current: OLD,
      latest: NEW,
    });

    const [onboarding] = await harness(
      agent({ starterKitOnboarded: undefined }),
    ).updates.updates();
    expect(onboarding?.state).toBe("onboarding");

    const [skipped] = await harness(
      agent({ kitUpdateSkipped: NEW }),
    ).updates.updates();
    expect(skipped?.state).toBe("skipped");
  });

  // TEST_SCENARIO: starting marks the head it targets and queues the update session; the report moves the stamp only for that commit.
  it("targets the head at start and accepts the report only for it", async () => {
    const h = harness(agent());
    await h.updates.startUpdate("agent-1");
    expect(h.marks.begun?.targetCommit).toBe(NEW);
    expect(h.bumped[0]).toMatch(/^kit-update:agent-1:/);

    const pendingAgent = agent({ kitUpdatePending: h.marks.begun! });
    let ended: SeedStamp | null | undefined;
    const reporter = createKitUpdateReporter({
      agentsFor: () => ({ get: async () => pendingAgent }),
      marks: {
        begin: async () => {},
        end: async (_id, stamp) => {
          ended = stamp;
        },
        skip: async () => {},
      },
    });
    await expect(reporter.report("agent-1", "user-1", OLD)).rejects.toThrow();
    await reporter.report("agent-1", "user-1", NEW);
    expect(ended).toEqual({ ...STAMP, commit: NEW });
  });

  // TEST_SCENARIO: the hover card shows only the changelog versions the update crosses.
  it("cuts the changelog to the crossed versions", () => {
    const changelog = [
      "# Changelog",
      "## 1.2.0 — 2026-10-01",
      "**Upgrade:** run x",
      "## 1.1.0 — 2026-09-20",
      "**Upgrade:** Nothing",
      "## 1.0.0 — 2026-09-01",
      "initial",
    ].join("\n");
    const cut = changelogBetween(changelog, "1.0.0", "1.2.0");
    expect(cut).toContain("## 1.2.0");
    expect(cut).toContain("## 1.1.0");
    expect(cut).not.toContain("1.0.0");
  });
});
