// TEST_OVERVIEW: Kit Update offers a newer definition when the stamped seed branch has moved, starts it as a pending session, and moves the Seed Stamp only for the commit the update targeted.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { Agent, KitUpdatePending, SeedStamp } from "api-server-api";

import {
  createMcpSession,
  type McpSessionDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";
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
    disabled: false,
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
  const bumped: { id: string; payload: unknown }[] = [];
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
      bump: async (_id: string, events: { id: string; payload: unknown }[]) => {
        bumped.push(...events);
        return 1;
      },
      enqueueAfterCommit: async () => {},
    } as never,
    sessionPair: async () => ({
      harness: "codex",
      provider: "openai-1",
      model: "gpt-5",
    }),
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

  // TEST_SCENARIO: starting marks the head it targets and queues the update session on the agent's default harness, provider and model; the report moves the stamp only for that commit.
  it("targets the head at start and accepts the report only for it", async () => {
    const h = harness(agent());
    await h.updates.startUpdate("agent-1");
    expect(h.marks.begun?.targetCommit).toBe(NEW);
    expect(h.bumped[0]?.id).toMatch(/^kit-update:agent-1:/);
    expect(h.bumped[0]?.payload).toMatchObject({
      harness: "codex",
      provider: "openai-1",
      model: "gpt-5",
    });

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

  // TEST_SCENARIO: an agent created from a link has no catalog row to compare against, yet its Seed Stamp still tracks the kit's branch, so it is offered updates like a catalog agent; the update session is told the kit came from a link rather than that it left a catalog it was never in.
  it("offers a kit update to an agent created from a link", async () => {
    const linked = agent({ starterKit: `link/guardian@${OLD}` });
    const [status] = await harness(linked).updates.updates();
    expect(status?.state).toBe("available");

    const h = harness(linked);
    await h.updates.startUpdate("agent-1");
    const task = (h.bumped[0]?.payload as { task: string }).task;
    expect(task).toContain("was created from a link rather than a catalog");
    expect(task).not.toContain("no longer listed");
  });

  // TEST_SCENARIO: nothing in the platform reports an update but the agent's own tool, so the briefing must not make the report wait on the user saying the update is finished — that is what left updates pending — and the closing instruction must be the last thing it reads.
  it("tells the agent to report the update itself, without waiting for the user", async () => {
    const h = harness(agent());
    await h.updates.startUpdate("agent-1");
    const task = (h.bumped[0]?.payload as { task: string }).task;
    expect(task).not.toMatch(/the user is done/i);
    expect(task).toContain("until you report it");

    const closing = task.slice(task.indexOf("Finishing this update:"));
    expect(closing).toContain("report_kit_updated");
    expect(closing).toContain(NEW);
    expect(closing).toMatch(/without asking the user/i);
    expect(task.indexOf("Finishing this update:")).toBeGreaterThan(
      task.indexOf("8. "),
    );
    expect(task.slice(task.indexOf("8. "))).toMatch(/Only after steps 1-7/);
  });

  // TEST_SCENARIO: the completion tool exists only while an update is pending, and both the briefing and the tool itself tell the agent to report without the user's word, since the tool is what clears the pending mark.
  it("carries a completion tool that reports the target commit itself", async () => {
    const report = vi.fn(async () => {});
    async function tools(kitUpdate: McpSessionDeps["kitUpdate"]) {
      const session = createMcpSession("agent-1", {
        channelManager: {},
        k8s: { namespace: "platform" },
        kitUpdate,
      } as unknown as McpSessionDeps);
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await session.server.connect(serverTransport);
      const client = new Client({ name: "test-harness", version: "1.0.0" });
      await client.connect(clientTransport);
      return client;
    }

    const idle = await tools(null);
    expect((await idle.listTools()).tools.map((t) => t.name)).not.toContain(
      "report_kit_updated",
    );

    const pending = await tools({
      report,
      cancel: async () => {},
    });
    const tool = (await pending.listTools()).tools.find(
      (t) => t.name === "report_kit_updated",
    );
    expect(tool?.description).toMatch(/do not ask the user for permission/i);

    const call = await pending.callTool({
      name: "report_kit_updated",
      arguments: { commit: NEW },
    });
    expect(call.isError).toBeFalsy();
    expect(report).toHaveBeenCalledWith("agent-1", NEW);
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
