import { NextOutline, WarningAltFilled } from "@carbon/icons-react";
import {
  Calendar,
  Conversation,
  DataStorage,
  GrowthMindset,
  MachineLearning_03,
  Robot,
  Slack,
} from "@carbon/pictograms-react";
import { type ReactNode, useMemo, useState } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { timeAgo, timeUntil } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../agents/components/avatar/agent-avatar.js";
import { startupTips } from "../../agents/startup-tips.js";
import { useApiKeys } from "../../api-keys/api/queries.js";
import { useArtifacts } from "../../artifacts/api/queries.js";
import { ResourcesCard } from "../../budgets/components/resources-card.js";
import { formatBytes } from "../../budgets/lib/pools.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useMonthlySpend } from "../../metrics/hooks/use-monthly-spend.js";
import { formatTokens } from "../../metrics/lib/format.js";
import { useOwnerSchedules } from "../../schedules/api/queries.js";
import { useOpenSidePanel } from "../../sessions/hooks/use-open-side-panel.js";
import { useAttention, useFeed } from "../api/queries.js";
import {
  CHANNEL_TYPE_LABELS,
  type ChannelType,
} from "../lib/activity-filter.js";
import {
  type AgentBucket,
  agentStates,
  busiestAgents,
  channelMix,
  dailyActivity,
  harnessMix,
  scheduleSummary,
  sessionsToday,
} from "../lib/home-stats.js";

const CARD = "flex flex-col rounded-xl border border-border bg-card p-5";

export function Card({
  title,
  pictogram,
  className,
  onOpen,
  children,
}: {
  title: string;
  pictogram?: ReactNode;
  className?: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        CARD,
        onOpen &&
          "relative transition-colors focus-within:outline-2 focus-within:outline-ring hover:border-border-ui hover:bg-muted/40",
        className,
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-sm text-muted-foreground">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="text-left outline-none after:absolute after:inset-0 after:rounded-xl"
            >
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        {pictogram && (
          <span className="-mt-1 -mr-1 shrink-0 text-muted-foreground/70">
            {pictogram}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Big({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function useSessions() {
  return useAttention().data?.items ?? [];
}

export function HeroCard() {
  const agents = useAgentsList();
  const { workingAgentIds } = useFeed();
  const sessions = useSessions();
  const now = new Date();
  return (
    <section
      aria-label="Overview"
      className="relative col-span-full overflow-hidden rounded-xl border border-border bg-card p-6 @2xl:p-8"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(60%_120%_at_100%_0%,var(--color-accent-light),transparent_60%)]"
      />
      <div className="relative grid items-end gap-6 @2xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h1 className="text-3xl font-light tracking-[-0.03em] text-balance text-foreground @2xl:text-5xl @6xl:text-6xl">
            {getBrand().title || getBrand().name}
          </h1>
          <div className="mt-6 flex flex-wrap gap-8">
            <Big value={agents.length} label="agents" />
            <Big value={workingAgentIds.size} label="working now" />
            <Big value={sessionsToday(sessions, now)} label="sessions today" />
          </div>
        </div>
        <MachineLearning_03
          aria-hidden
          className="hidden h-44 w-auto justify-self-end text-foreground/80 @2xl:block"
        />
      </div>
    </section>
  );
}

export function ResourcesBarsCard() {
  const agents = useAgentsList();
  const { workingAgentIds } = useFeed();
  return (
    <section aria-label="Resources" className={cn(CARD, "@xl:col-span-2")}>
      <ResourcesCard agents={agents} workingAgentIds={workingAgentIds} />
    </section>
  );
}

export function TipCard() {
  const tips = useMemo(() => startupTips("my-agent"), []);
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * tips.length),
  );
  const tip = tips[index % tips.length]!;
  return (
    <Card
      title="Tip"
      pictogram={<GrowthMindset size={48} aria-hidden />}
      className="bg-callout"
    >
      <p className="flex-1 text-base leading-relaxed text-foreground">
        {tip.split("`").map((part, i) =>
          i % 2 ? (
            <code
              key={i}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
            >
              {part}
            </code>
          ) : (
            part
          ),
        )}
      </p>
      <button
        type="button"
        onClick={() => setIndex((i) => i + 1)}
        className="mt-4 flex items-center gap-1.5 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <NextOutline size={14} /> Next tip
      </button>
    </Card>
  );
}

const CHANNEL_TONE: Record<ChannelType, string> = {
  chat: "bg-icon-blue",
  slack: "bg-icon-violet",
  telegram: "bg-icon-teal",
  schedule: "bg-icon-ochre",
  terminal: "bg-icon-clay",
};

export function ChannelsCard() {
  const sessions = useSessions();
  const mix = channelMix(sessions);
  const total = mix.reduce((n, c) => n + c.count, 0);
  return (
    <Card
      title="Where conversations happen"
      pictogram={<Conversation size={48} aria-hidden />}
      className="@xl:col-span-2"
    >
      <div className="mb-4 flex h-3 w-full gap-px overflow-hidden rounded-full bg-muted">
        {total > 0 &&
          mix
            .filter((c) => c.count > 0)
            .map((c) => (
              <div
                key={c.key}
                className={CHANNEL_TONE[c.key]}
                style={{ width: `${(c.count * 100) / total}%` }}
                title={`${CHANNEL_TYPE_LABELS[c.key]} · ${c.count}`}
              />
            ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {mix.map((c) => (
          <li key={c.key} className="flex items-center gap-2">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                CHANNEL_TONE[c.key],
              )}
            />
            <span className="flex-1 text-muted-foreground">
              {CHANNEL_TYPE_LABELS[c.key]}
            </span>
            <span className="text-foreground tabular-nums">{c.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Across your {total} most recent sessions.
      </p>
    </Card>
  );
}

const BUCKET_LABEL: Record<AgentBucket, string> = {
  working: "Working",
  awake: "Awake, idle",
  asleep: "Asleep",
  trouble: "Need attention",
};
const BUCKET_TONE: Record<AgentBucket, string> = {
  working: "bg-accent",
  awake: "bg-success",
  asleep: "bg-muted-foreground/40",
  trouble: "bg-danger",
};

export function AgentStatesCard() {
  const agents = useAgentsList();
  const { workingAgentIds } = useFeed();
  const states = agentStates(agents, workingAgentIds);
  const vm = agents.filter((a) => a.vm).length;
  return (
    <Card title="Agents" pictogram={<Robot size={48} aria-hidden />}>
      <ul className="flex flex-col gap-2 text-sm">
        {states.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={cn("size-2 shrink-0 rounded-full", BUCKET_TONE[s.key])}
            />
            <span className="flex-1 text-muted-foreground">
              {BUCKET_LABEL[s.key]}
            </span>
            <span className="text-foreground tabular-nums">{s.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-4 text-xs text-muted-foreground">
        {vm} VM · {agents.length - vm} container
      </p>
    </Card>
  );
}

export function HarnessCard() {
  const agents = useAgentsList();
  const mix = harnessMix(agents);
  const max = mix[0]?.count ?? 0;
  return (
    <Card title="Harnesses">
      <ul className="flex flex-col gap-2.5">
        {mix.map((h) => (
          <li key={h.key} className="flex items-center gap-2.5 text-sm">
            <HarnessIcons harnesses={[h.key]} size="sm" />
            <span className="w-24 truncate text-muted-foreground">{h.key}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/60"
                style={{ width: `${max ? (h.count * 100) / max : 0}%` }}
              />
            </div>
            <span className="w-6 text-right text-foreground tabular-nums">
              {h.count}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ActivityCard() {
  const sessions = useSessions();
  const days = dailyActivity(sessions, new Date());
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);
  return (
    <Card title="Activity, last 14 days" className="@xl:col-span-2">
      <div className="flex items-end gap-6">
        <Big value={total} label="sessions active" />
        <div
          className="flex h-24 flex-1 items-end gap-1"
          role="img"
          aria-label="Sessions per day"
        >
          {days.map((d) => (
            <div
              key={d.day}
              title={`${d.day} · ${d.count}`}
              className={cn(
                "flex-1 rounded-t-sm",
                d.count ? "bg-accent/70 hover:bg-accent" : "bg-muted",
              )}
              style={{ height: `${Math.max(4, (d.count * 100) / max)}%` }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

export function BusiestCard() {
  const sessions = useSessions();
  const agents = useAgentsList();
  const startSession = useStore((s) => s.selectAgent);
  const top = busiestAgents(sessions, agents);
  return (
    <Card title="Busiest agents" className="@xl:col-span-2">
      <ol className="flex flex-col gap-1">
        {top.map(({ agent, count }, i) => (
          <li key={agent.id}>
            <button
              type="button"
              onClick={() => startSession(agent.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-sm transition-colors hover:bg-muted"
            >
              <span className="w-4 text-xs text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <AgentAvatar
                name={agent.name}
                avatar={agent.avatar}
                size={20}
                mood={avatarMood(agent.state, agent)}
              />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {agent.name}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {count} sessions
              </span>
            </button>
          </li>
        ))}
      </ol>
      {top.length === 0 && (
        <p className="text-sm text-muted-foreground">No sessions yet.</p>
      )}
    </Card>
  );
}

export function SchedulesCard() {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { data } = useOwnerSchedules();
  const agents = useAgentsList();
  const summary = scheduleSummary(data ?? [], new Date());
  const nextAgent = summary.next
    ? agents.find((a) => a.id === summary.next!.schedule.agentId)
    : undefined;
  return (
    <Card
      title="Schedules"
      pictogram={<Calendar size={48} aria-hidden />}
      onOpen={() => navigateToSettings("schedules")}
    >
      <div className="flex gap-8">
        <Big value={summary.enabled} label={`on, of ${summary.total}`} />
        {summary.failing > 0 && (
          <Big
            value={
              <span className="flex items-center gap-1.5 text-warning">
                <WarningAltFilled size={20} />
                {summary.failing}
              </span>
            }
            label="stopped or failing"
          />
        )}
      </div>
      <p className="mt-auto pt-4 text-sm text-muted-foreground">
        {summary.next ? (
          <>
            Next:{" "}
            <span className="text-foreground">
              {summary.next.schedule.name}
            </span>
            {nextAgent && ` on ${nextAgent.name}`} {timeUntil(summary.next.at)}
          </>
        ) : (
          "Nothing scheduled."
        )}
      </p>
    </Card>
  );
}

export function ConnectionsCard() {
  const { data } = useAppConnections();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const connections = data ?? [];
  const active = connections.filter((c) => c.status === "active").length;
  const broken = connections.length - active;
  return (
    <Card
      title="Connections"
      pictogram={<Slack size={48} aria-hidden />}
      onOpen={() => navigateToSettings("connections")}
    >
      <div className="flex gap-8">
        <Big value={active} label="active" />
        {broken > 0 && <Big value={broken} label="need reconnecting" />}
      </div>
    </Card>
  );
}

export function ArtifactsCard() {
  const openSidePanel = useOpenSidePanel();
  const { data } = useArtifacts();
  const artifacts = data ?? [];
  const bytes = artifacts.reduce((n, a) => n + (a.sizeBytes ?? 0), 0);
  const viewed = [...artifacts].sort(
    (a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0),
  )[0];
  return (
    <Card
      title="Artifacts"
      pictogram={<DataStorage size={48} aria-hidden />}
      onOpen={() => openSidePanel("artifacts")}
    >
      <div className="flex gap-8">
        <Big value={artifacts.length} label="published" />
        <Big value={formatBytes(bytes)} label="in total" />
      </div>
      {viewed && (viewed.viewCount ?? 0) > 0 && (
        <p className="mt-auto truncate pt-4 text-xs text-muted-foreground">
          Most viewed: <span className="text-foreground">{viewed.title}</span> ·{" "}
          {viewed.viewCount} views
        </p>
      )}
    </Card>
  );
}

export function ApiKeysCard() {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { data } = useApiKeys();
  const keys = data ?? [];
  const now = Date.now();
  const soon = keys.filter((k) => {
    const left = k.expiresAt ? Date.parse(k.expiresAt) - now : -1;
    return left >= 0 && left < 7 * 86_400_000;
  }).length;
  const lastUsed = keys
    .map((k) => k.lastUsedAt)
    .filter((t): t is string => !!t)
    .sort()
    .reverse()[0];
  return (
    <Card title="API keys" onOpen={() => navigateToSettings("api-keys")}>
      <div className="flex gap-8">
        <Big value={keys.length} label="keys" />
        {soon > 0 && <Big value={soon} label="expire this week" />}
      </div>
      <p className="mt-auto pt-4 text-xs text-muted-foreground">
        {lastUsed ? `Last used ${timeAgo(lastUsed)}` : "Never used yet."}
      </p>
    </Card>
  );
}

export function TokensCard() {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { data, state, label } = useMonthlySpend();
  if (state === "unavailable") return null;
  const models = data?.byModel ?? [];
  const sum = (k: "inputTokens" | "outputTokens" | "cacheReadTokens") =>
    models.reduce((n, m) => n + m[k], 0);
  const input = sum("inputTokens");
  const cached = sum("cacheReadTokens");
  const calls = models.reduce((n, m) => n + m.calls, 0);
  const ms = models.reduce((n, m) => n + m.durationMs, 0);
  return (
    <Card title={`Tokens, ${label}`} onOpen={() => navigateToSettings("usage")}>
      <div className="grid grid-cols-2 gap-4">
        <Big value={formatTokens(input + cached)} label="read" />
        <Big value={formatTokens(sum("outputTokens"))} label="written" />
        <Big
          value={`${input + cached ? Math.round((cached * 100) / (input + cached)) : 0}%`}
          label="from cache"
        />
        <Big
          value={calls ? `${(ms / calls / 1000).toFixed(1)}s` : "—"}
          label="per model call"
        />
      </div>
    </Card>
  );
}
