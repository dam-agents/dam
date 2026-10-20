// TEST_OVERVIEW: returning to a tab or reconnecting the API refetches the families no stream or poll carries, and nothing else: every mutable family outside the owner stream's hints heals on return and on reconnect, while a family the stream carries and an unrelated key stay put, so neither event fans out into a refetch of everything on screen.
import {
  focusManager,
  onlineManager,
  type QueryKey,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());
vi.mock("../../store.js", () => ({ useStore: {} }));
vi.stubGlobal("navigator", { onLine: true });
const { queryClient } = await import("../../query-client.js");
const { acpSessionsKeys } = await import("../../modules/sessions/api/keys.js");
const { agentsKeys } = await import("../../modules/agents/api/queries.js");
const { onFetchError, onFetchSuccess } =
  await import("../../lib/api-health.js");
const { trpc } = await import("../../trpc.js");
const { changesKeys } = await import("../../modules/changes/api/keys.js");
const { processKeys } = await import("../../modules/processes/api/keys.js");
const { harnessConfigCurrentKey, harnessCatalogModelsKey, providerModelsKey } =
  await import("../../modules/sessions/api/session-pair.js");
const { scheduleSessionsKey } =
  await import("../../modules/schedules/api/queries.js");
const { termsKeys } = await import("../../modules/terms/api/queries.js");

const unsubscribes: (() => void)[] = [];

beforeEach(() => queryClient.mount());

afterEach(() => {
  unsubscribes.splice(0).forEach((off) => off());
  queryClient.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  queryClient.unmount();
});

function watch(queryKey: QueryKey) {
  let calls = 0;
  unsubscribes.push(
    new QueryObserver(queryClient, {
      queryKey,
      queryFn: () => Promise.resolve(++calls),
    }).subscribe(() => {}),
  );
  return { calls: () => calls };
}

async function watchAll(families: Record<string, QueryKey>) {
  const watched = Object.fromEntries(
    Object.entries(families).map(([name, key]) => [name, watch(key)]),
  );
  await vi.waitFor(() => {
    for (const [name, key] of Object.entries(families))
      expect(
        queryClient.getQueryState(key)?.status,
        `first read of ${name}`,
      ).toBe("success");
  });
  return {
    expectCalls: (count: number) =>
      vi.waitFor(() =>
        expect(
          Object.fromEntries(
            Object.entries(watched).map(([name, w]) => [name, w.calls()]),
          ),
        ).toEqual(
          Object.fromEntries(Object.keys(watched).map((name) => [name, count])),
        ),
      ),
  };
}

async function returnToTheTab() {
  focusManager.setFocused(false);
  focusManager.setFocused(true);
}

async function reconnectTheApi() {
  onFetchError();
  onFetchError();
  onFetchSuccess();
}

async function expectRefetchedOnReturnAndReconnect(
  families: Record<string, QueryKey>,
) {
  const watched = await watchAll(families);
  await returnToTheTab();
  await watched.expectCalls(2);
  await reconnectTheApi();
  await watched.expectCalls(3);
}

// TEST_SCENARIO: a tab comes back into view and the API reconnects a moment later, while a query the owner stream carries and an unrelated key sit on screen with the same age. The carried family heals through its own hint and the unrelated key keeps its data, which proves the two events are scoped rather than global.
it("leaves a family the stream carries and an unrelated key alone", async () => {
  const watched = await watchAll({
    "owner-stream family": agentsKeys.listWithChannels(),
    unrelated: ["unrelated"],
  });

  await returnToTheTab();
  await reconnectTheApi();
  await watched.expectCalls(1);
  expect(queryClient.getQueryState(["unrelated"])?.isInvalidated).toBe(true);
});

// TEST_SCENARIO: a tab returns and then the connection comes back while the ACP Session list is still fresh by its 5 s staleTime. A tab return must leave the paginated list alone, because it refetches on mount and polls on a runtime without live updates, but a reconnect must refetch it anyway: its notices are not replayed to a new observer, so the assertion runs on the online transition alone, with no stale marking to lean on.
it("refetches a fresh ACP Session list on reconnect, not on return", async () => {
  const sessions = watch(acpSessionsKeys.pagesOf("agent-a", []));
  await vi.waitFor(() =>
    expect(
      queryClient.getQueryState(acpSessionsKeys.pagesOf("agent-a", []))?.status,
    ).toBe("success"),
  );

  await returnToTheTab();
  expect(sessions.calls()).toBe(1);

  onlineManager.setOnline(false);
  onlineManager.setOnline(true);

  await vi.waitFor(() => expect(sessions.calls()).toBe(2));
});

// TEST_SCENARIO: provider grants and channel links change in another client. The connection list, the per-agent grants, the Telegram chats, the Telegram bot and the Slack install availability must all re-read when this tab returns, and again when the API reconnects.
it("refreshes the connection, grant and channel families", async () => {
  await expectRefetchedOnReturnAndReconnect({
    connections: trpc.connections.list.queryKey(),
    grants: trpc.connections.getAgentConnections.queryKey({ agentId: "a" }),
    "telegram chats": trpc.agents.listTelegramChats.queryKey({ agentId: "a" }),
    "telegram bot": trpc.channels.telegramBot.queryKey(),
    "slack availability": ["slack", "install", "availability"],
  });
});

// TEST_SCENARIO: another tab enables a feature, revokes an API key, changes the chat-form preference or reorders the sidebar, and an access check is restored after being denied. Every one of those families must re-read on return and on reconnect, because the server projects no live hint for them.
it("refreshes the account preference, key and access families", async () => {
  await expectRefetchedOnReturnAndReconnect({
    "feature flags": trpc.features.flags.queryKey(),
    "api keys": trpc.apiKeys.list.queryKey(),
    "chat form preferences": trpc.chatForms.preferences.queryKey({
      agentId: "a",
    }),
    "sidebar order": trpc.sidebarOrder.get.queryKey(),
    "agent access": trpc.agents.get.queryKey({ id: "a" }),
    "runtime migration": trpc.agents.planRuntimeMigration.queryKey({
      agentId: "a",
    } as never),
  });
});

// TEST_SCENARIO: a skill source, set or rendered SKILL.md changes in another client or under the agent itself. Every skill family must re-read on return and on reconnect, including the state query that only polls while the editor asks it to.
it("refreshes the skill families", async () => {
  await expectRefetchedOnReturnAndReconnect({
    sources: trpc.skills.sources.list.queryKey(),
    scan: trpc.skills.listWithScan.queryKey({ agentId: "a" } as never),
    sets: trpc.skills.sets.list.queryKey(),
    "local skill": trpc.skills.readLocal.queryKey({} as never),
    "skill content": trpc.skills.getSkillContent.queryKey({} as never),
    "skill state": trpc.skills.state.queryKey({ agentId: "a" } as never),
  });
});

// TEST_SCENARIO: a scheduled run completes while its results view stays open. That view reads the Session list under its own key, and it must re-read on return and on reconnect like the Session list it belongs to.
it("refreshes a schedule's recorded runs", async () => {
  await expectRefetchedOnReturnAndReconnect({
    "schedule sessions": scheduleSessionsKey("a", "schedule-1"),
  });
});

// TEST_SCENARIO: a satellite is disconnected or revoked from another client while the agent settings screen holds the non-polling satellite list. That list must re-read on return and on reconnect.
it("refreshes the satellite list of a screen that does not poll", async () => {
  await expectRefetchedOnReturnAndReconnect({
    satellites: trpc.satellites.list.queryKey(),
  });
});

// TEST_SCENARIO: provider quota is spent elsewhere, a telemetry read failed while it was polled, or a spend page settled long ago. Each of those families must re-read on return and on reconnect, because its poll has stopped or never existed.
it("refreshes the usage families whose polls stop", async () => {
  await expectRefetchedOnReturnAndReconnect({
    balance: trpc.connections.getProviderBalance.queryKey({ id: "conn-1" }),
    "legacy spend": trpc.metrics.spendBreakdown.queryKey({} as never),
    turns: trpc.telemetry.turns.queryKey({} as never),
    turn: trpc.telemetry.turn.queryKey({} as never),
    "invocation turns": trpc.telemetry.invocationTurns.queryKey({} as never),
    "invocation tree": trpc.invocations.tree.queryKey({} as never),
    transcript: trpc.invocations.transcript.queryKey({} as never),
    "spend sessions": trpc.spend.sessions.queryKey({} as never),
    "spend turns": trpc.spend.turns.queryKey({} as never),
  });
});

// TEST_SCENARIO: the agent runs a runtime without live updates, so its pod watches are absent: harness settings edited through its terminal, a worktree changed under an open Changes panel, a process list with no poll, and a filtered Session query next to it. All of them must re-read on return and on reconnect.
it("refreshes the families a runtime without live updates cannot watch", async () => {
  await expectRefetchedOnReturnAndReconnect({
    "harness config": harnessConfigCurrentKey("a", "harness-1"),
    "provider models": providerModelsKey("a", "harness-1", "provider-1"),
    "catalog models": harnessCatalogModelsKey("a", "harness-1", []),
    changes: changesKeys.list("a", "session-1"),
    processes: processKeys.list("a"),
    "session query": acpSessionsKeys.query("a", {}),
    "single session": acpSessionsKeys.session("a", "session-1"),
  });
});

// TEST_SCENARIO: an API rollout lands under an open tab, with new install capabilities, metering, templates, catalog entries, OAuth credential families, links or usage-inspection availability. Every deployment-dependent family must re-read on return and on reconnect.
it("refreshes the install and catalog families", async () => {
  await expectRefetchedOnReturnAndReconnect({
    capabilities: trpc.features.install.queryKey(),
    "connection templates": trpc.connections.listTemplates.queryKey(),
    templates: trpc.templates.list.queryKey(),
    harnesses: trpc.templates.harnesses.queryKey(),
    kits: trpc.starterKits.list.queryKey(),
    kit: trpc.starterKits.get.queryKey({ id: "kit-1" } as never),
    "usage availability": ["usage", "inspect", "availability"],
    metering: trpc.spend.metering.queryKey(),
    links: trpc.links.all.queryKey(),
    version: ["version"],
    "terms document": termsKeys.document(),
    "terms acceptance": trpc.terms.latestAcceptance.queryKey(),
  });
});
