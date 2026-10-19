import {
  type HarnessFamily,
  SessionMode,
  SessionType,
  type SessionView,
} from "api-server-api";

import { HARNESS_ICONS } from "@/components/harness-icons";

import { modelDisplayName } from "../../sessions/lib/model-name.js";

export type ActivityTone = "approval" | "working" | "unread" | "idle";

export const ACTIVITY_LABEL: Record<ActivityTone, string> = {
  approval: "Needs your approval",
  working: "Working",
  unread: "Unread",
  idle: "Idle",
};

export function activityTone(state: {
  working: boolean;
  needsApproval: boolean;
  unread: boolean;
}): ActivityTone {
  if (state.needsApproval) return "approval";
  if (state.working) return "working";
  return state.unread ? "unread" : "idle";
}

export function toggleExpanded(
  expanded: ReadonlySet<string>,
  agentId: string,
): ReadonlySet<string> {
  const next = new Set(expanded);
  if (!next.delete(agentId)) next.add(agentId);
  return next;
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
 * where the Session came from).
 */
export function sessionContext(
  s: Pick<SessionView, "harness" | "model" | "type" | "mode" | "scheduleId">,
  conversation?: string,
): string {
  const source =
    s.mode === SessionMode.Terminal
      ? "Terminal"
      : s.scheduleId
        ? SOURCE[SessionType.ScheduleCron]
        : SOURCE[s.type];
  return [
    s.harness &&
      (HARNESS_ICONS[s.harness as HarnessFamily]?.label ?? s.harness),
    s.model && modelDisplayName(s.model),
    conversation ? `${source} ${conversation}` : source,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function awaitsApproval(
  approvals: readonly {
    status: string;
    agentId: string;
    sessionId: string | null;
  }[],
  agentId: string,
  sessionId: string,
): boolean {
  return approvals.some(
    (a) =>
      a.status === "pending" &&
      a.agentId === agentId &&
      a.sessionId === sessionId,
  );
}
