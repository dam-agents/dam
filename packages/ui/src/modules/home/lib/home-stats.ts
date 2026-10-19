import type { AttentionItem } from "api-server-api";

import type { AgentView, Schedule } from "../../../types.js";
import { isUpcoming } from "../../schedules/lib/once-schedule.js";
import {
  CHANNEL_TYPES,
  type ChannelType,
  channelTypeOfSession,
} from "./activity-filter.js";

export interface Count<K extends string = string> {
  key: K;
  count: number;
}

const sessionAt = (s: AttentionItem) => Date.parse(s.activityAt ?? s.createdAt);

export function channelMix(
  sessions: readonly AttentionItem[],
): Count<ChannelType>[] {
  const counts = new Map<ChannelType, number>(CHANNEL_TYPES.map((c) => [c, 0]));
  for (const s of sessions) {
    const c = channelTypeOfSession(s);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return CHANNEL_TYPES.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function dailyActivity(
  sessions: readonly AttentionItem[],
  now: Date,
  days = 14,
): { day: string; count: number }[] {
  // UNIT_BOUNDARY_DESCRIPTION: buckets start at local midnights rather than fixed 24 h steps, so a DST change keeps the days aligned.
  const starts = Array.from(
    { length: days + 1 },
    (_, i) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1 + i),
  );
  return starts.slice(0, days).map((start, i) => ({
    day: localDay(start),
    count: sessions.filter((s) => {
      const at = sessionAt(s);
      return at >= start.getTime() && at < starts[i + 1]!.getTime();
    }).length,
  }));
}

export type AgentBucket = "working" | "awake" | "asleep" | "trouble";

export function agentStates(
  agents: readonly AgentView[],
  workingAgentIds: ReadonlySet<string>,
): Count<AgentBucket>[] {
  const bucket = (a: AgentView): AgentBucket =>
    a.state === "error" || a.state === "over_budget" || a.overBudget
      ? "trouble"
      : a.state === "hibernated" || a.state === "hibernating" || a.disabled
        ? "asleep"
        : workingAgentIds.has(a.id)
          ? "working"
          : "awake";
  const order: AgentBucket[] = ["working", "awake", "asleep", "trouble"];
  return order.map((key) => ({
    key,
    count: agents.filter((a) => bucket(a) === key).length,
  }));
}

export function harnessMix(agents: readonly AgentView[]): Count[] {
  const counts = new Map<string, number>();
  for (const a of agents) {
    const h = a.harness ?? "unknown";
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function busiestAgents(
  sessions: readonly AttentionItem[],
  agents: readonly AgentView[],
  limit = 5,
): { agent: AgentView; count: number }[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const counts = new Map<string, number>();
  for (const s of sessions)
    counts.set(s.agentId, (counts.get(s.agentId) ?? 0) + 1);
  return [...counts]
    .flatMap(([id, count]) => {
      const agent = byId.get(id);
      return agent ? [{ agent, count }] : [];
    })
    .sort(
      (a, b) => b.count - a.count || a.agent.name.localeCompare(b.agent.name),
    )
    .slice(0, limit);
}

export interface ScheduleSummary {
  total: number;
  enabled: number;
  failing: number;
  next: { schedule: Schedule; at: number } | null;
}

export function scheduleSummary(
  schedules: readonly Schedule[],
  now: Date,
): ScheduleSummary {
  let next: ScheduleSummary["next"] = null;
  for (const s of schedules) {
    if (!isUpcoming(s) || !s.status?.nextRun) continue;
    const at = Date.parse(s.status.nextRun);
    if (at >= now.getTime() && (!next || at < next.at))
      next = { schedule: s, at };
  }
  return {
    total: schedules.length,
    enabled: schedules.filter(isUpcoming).length,
    failing: schedules.filter(
      (s) => !!s.status?.lastPrecheckError || !!s.status?.stopReason,
    ).length,
    next,
  };
}

export function sessionsToday(
  sessions: readonly AttentionItem[],
  now: Date,
): number {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  return sessions.filter((s) => sessionAt(s) >= start).length;
}
