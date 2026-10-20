import {
  type ApprovalView,
  type HarnessFamily,
  SessionMode,
  SessionType,
  type SessionView,
} from "api-server-api";

import { HARNESS_ICONS } from "@/components/harness-icons";

import { acpSessionsKeys } from "../../sessions/api/keys.js";
import { modelDisplayName } from "../../sessions/lib/model-name.js";

export type ActivityTone =
  "approval" | "working" | "background" | "unread" | "draft" | "idle";

export const ACTIVITY_LABEL: Record<ActivityTone, string> = {
  approval: "Needs your approval",
  working: "Working",
  background: "Working in the background",
  unread: "Unread",
  draft: "Has a draft",
  idle: "Idle",
};

export function activityTone(state: {
  working: boolean;
  needsApproval: boolean;
  unread: boolean;
  backgroundWork?: readonly unknown[];
  draft?: boolean;
}): ActivityTone {
  if (state.needsApproval) return "approval";
  if (state.working) return "working";
  if (state.backgroundWork?.length) return "background";
  if (state.unread) return "unread";
  return state.draft ? "draft" : "idle";
}

export function isExpanded(
  toggled: ReadonlyMap<string, boolean>,
  agentId: string,
  openAgentId: string | null,
): boolean {
  return toggled.get(agentId) ?? agentId === openAgentId;
}

export function toggleExpanded(
  toggled: ReadonlyMap<string, boolean>,
  agentId: string,
  openAgentId: string | null,
): ReadonlyMap<string, boolean> {
  return new Map(toggled).set(
    agentId,
    !isExpanded(toggled, agentId, openAgentId),
  );
}

export function offFeedPins(
  pins: ReadonlySet<string>,
  inFeed: ReadonlySet<string>,
  agentIds: readonly string[],
): { agentId: string; sessionId: string }[] {
  return [...pins]
    .filter((key) => !inFeed.has(key))
    .flatMap((key) =>
      agentIds
        .filter((id) => key.startsWith(`${id}:`))
        .map((agentId) => ({
          agentId,
          sessionId: key.slice(agentId.length + 1),
        })),
    );
}

export function pinActivityQuery(agentId: string, sessionId: string) {
  return {
    queryKey: acpSessionsKeys.session(agentId, sessionId),
    enabled: false,
    select: (s: SessionView | null) => s?.updatedAt ?? s?.createdAt,
  };
}

export function splitPinned<T>(
  rows: readonly T[],
  isPinned: (row: T) => boolean,
): [pinned: T[], rest: T[]] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const row of rows) (isPinned(row) ? pinned : rest).push(row);
  return [pinned, rest];
}

const SOURCE: Record<SessionType, string> = {
  [SessionType.Regular]: "Chat",
  [SessionType.ChannelSlack]: "Slack",
  [SessionType.ChannelTelegram]: "Telegram",
  [SessionType.ScheduleCron]: "Schedule",
  [SessionType.ScheduleOnce]: "Schedule",
  [SessionType.CliRun]: "CLI",
  [SessionType.Invocation]: "Invocation",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: The new layout's sidebar tree: which Session
 * rows sit in the Pinned section, which Agents are open, the activity dot a
 * Session row shows, and the context line under its title (harness, model and
 * where the Session came from). A terminal Session names no source there: the
 * row's terminal icon says it.
 */
export function sessionContext(
  s: Pick<SessionView, "harness" | "model" | "type" | "mode" | "scheduleId">,
  conversation?: string,
): string {
  const source =
    s.mode === SessionMode.Terminal
      ? null
      : s.scheduleId
        ? SOURCE[SessionType.ScheduleCron]
        : SOURCE[s.type];
  return [
    s.harness &&
      (HARNESS_ICONS[s.harness as HarnessFamily]?.label ?? s.harness),
    s.model && modelDisplayName(s.model),
    source && (conversation ? `${source} ${conversation}` : source),
  ]
    .filter(Boolean)
    .join(" · ");
}

type ApprovalRef = Pick<ApprovalView, "status" | "agentId" | "sessionId">;

export function awaitsApproval(
  approvals: readonly ApprovalRef[],
  agentId: string,
  sessionId?: string,
): boolean {
  return approvals.some(
    (a) =>
      a.status === "pending" &&
      a.agentId === agentId &&
      (sessionId === undefined || a.sessionId === sessionId),
  );
}
