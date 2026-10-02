/**
 * Shared plumbing for the Agents / Sessions / Files / Telemetry component
 * stories. Nothing here renders UI: it only seeds the real query cache and the
 * real zustand store from the fixtures, so each story renders the real
 * component against the same data the page stories use.
 */
import type { PodSession } from "agent-runtime-api";
import { SessionMode, type SessionView } from "api-server-api";

import { api } from "@/api";
import { queryClient } from "@/query-client";
import { useStore } from "@/store";
import { trpc } from "@/trpc";
import type { AgentView, Message } from "@/types";

import {
  applyUpdate,
  finalizeAllStreaming,
} from "../../../modules/acp/session-projection.js";
import { agentsKeys } from "../../../modules/agents/api/queries.js";
import { resolveAgentDisplay } from "../../../modules/agents/utils/agent-resolver.js";
import { agentHistory, SESSIONS } from "../../backend/agent-fixtures";
import { AGENTS } from "../../backend/fixtures/agents";
import { FLAGS } from "../../backend/fixtures/shell";
import { IDS, setScenario } from "../../backend/scenario";

/** Seeded entries never go stale, so the fake backend can't overwrite them. */
const PINNED = { updatedAt: Date.now() + 365 * 24 * 60 * 60_000 };

const NO_IDS: ReadonlySet<string> = new Set();

export function fixtureAgent(id: string): AgentView {
  const found = AGENTS.find((a) => a.id === id);
  if (!found) throw new Error(`no fixture agent ${id}`);
  return found;
}

/** The checkout-service fixture agent with some fields overridden. */
export function codingAgent(over: Partial<AgentView> = {}): AgentView {
  return { ...fixtureAgent(IDS.codingAgent), ...over };
}

/** The display the real `resolveAgentDisplay` derives for `agent`. */
export function displayOf(
  agent: AgentView,
  opts: { restarting?: boolean; pausing?: boolean } = {},
) {
  return resolveAgentDisplay(
    agent,
    opts.restarting ? new Set([agent.id]) : NO_IDS,
    opts.pausing ? new Set([agent.id]) : NO_IDS,
  );
}

/** A fixture pod session as the api-server's `SessionView`. */
export function sessionView(
  agentId: string,
  index: number,
  over: Partial<SessionView> = {},
): SessionView {
  const pod: PodSession | undefined = SESSIONS[agentId]?.[index];
  if (!pod) throw new Error(`no fixture session ${agentId}[${index}]`);
  const mode =
    pod.mode === "terminal" ? SessionMode.Terminal : SessionMode.Chat;
  return { ...pod, mode, agentId, ...over };
}

/** A fixture transcript projected into chat messages by the real ACP
 *  projection, exactly as the chat view builds them on session/load. */
export function transcriptMessages(
  agentId: string = IDS.codingAgent,
  sessionId: string = IDS.session1,
): Message[] {
  let messages: Message[] = [];
  for (const { update, at } of agentHistory(agentId)[sessionId] ?? [])
    messages = applyUpdate(messages, update, at);
  return finalizeAllStreaming(messages);
}

/** Resets the query cache and the store fields these stories touch, so a
 *  story never inherits state from the one viewed before it. */
export function resetState() {
  setScenario("populated");
  queryClient.clear();
  useStore.setState({
    selectedAgent: null,
    sessionId: null,
    messages: [],
    pendingPermissions: [],
    openFilePath: null,
    openFileDirty: false,
    openFileEdit: false,
    expandedDirs: {},
    importingAgents: {},
    drafts: {},
  });
}

/** Loader: fresh state, then the agent list the real `useAgents` hook reads. */
export function seedAgents(list: AgentView[] = AGENTS) {
  return async () => {
    resetState();
    const availableChannels = await api.channels.available.query();
    queryClient.setQueryData(
      agentsKeys.listWithChannels(),
      { list, availableChannels },
      PINNED,
    );
    return {};
  };
}

/** Seeds the two answers `useVmRuntime` reads: the user's `vm-sandboxes` flag
 *  and whether the install can virtualize. Call after `seedAgents`. */
export function seedVmRuntime(vm: boolean) {
  seedFlags({ "vm-sandboxes": vm });
  queryClient.setQueryData(
    trpc.features.install.queryKey(),
    { virtualization: vm },
    PINNED,
  );
}

/** Turns feature flags on or off on top of the fixture defaults (or on top of
 *  flags an earlier seed already set). */
export function seedFlags(over: Partial<typeof FLAGS>) {
  const key = trpc.features.flags.queryKey();
  const current = queryClient.getQueryData<typeof FLAGS>(key) ?? FLAGS;
  queryClient.setQueryData(key, { ...current, ...over }, PINNED);
}

export function seedQuery<T>(key: readonly unknown[], data: T) {
  queryClient.setQueryData(key, data, PINNED);
}
