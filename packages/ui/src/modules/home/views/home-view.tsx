import { useMemo, useState } from "react";

import { ListSkeleton } from "@/components/list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  useApproveOnce,
  useDenyForever,
} from "../../approvals/api/mutations.js";
import {
  formatCost,
  type SpendPeriod,
  timeAgo,
  useAgentRows,
  useArtifacts,
  useDriverSummaries,
  useKbActivity,
  usePendingApprovals,
  useRecentScheduleRuns,
  useSpendOverview,
} from "../home-data.js";

/* ═══════════════════════════════════════════════════════════════════════════
   Home Page
   ═══════════════════════════════════════════════════════════════════════════ */

export function HomeView() {
  const { agentsData, initialLoaded } = useAgentRows();
  const agents = agentsData?.list ?? [];

  if (!initialLoaded) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Home"
          description="What your agents have been up to, and what needs your attention."
        />
        <ListSkeleton rows={4} rowHeight={56} />
      </div>
    );
  }

  if (agents.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Home"
        description="What your agents have been up to, and what needs your attention."
      />
      <DashboardMetrics agents={agents} />
      <ApprovalsSection agents={agents} />
      <ScheduleRunsSection agents={agents} />
      <ArtifactsSection agents={agents} />
      <ExperimentsSection agents={agents} />
      <KnowledgeBaseSection agents={agents} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Budget
   ═══════════════════════════════════════════════════════════════════════════ */

const PERIOD_LABELS: Record<SpendPeriod, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
};

const SHORT_PERIOD_LABELS: Record<SpendPeriod, string> = {
  today: "1D",
  week: "1W",
  month: "1M",
  year: "1Y",
};

function DashboardMetrics({ agents }: { agents: AgentView[] }) {
  return (
    <section aria-label="Dashboard metrics">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SpendChart agents={agents} />
        <ComputeResources agents={agents} />
      </div>
    </section>
  );
}

function SpendChart({ agents }: { agents: AgentView[] }) {
  const [period, setPeriod] = useState<SpendPeriod>("month");
  const { data: spend } = useSpendOverview(period);
  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  if (!spend) return null;

  const topSpenders = spend.perAgent
    .filter((s) => s.periodUsd > 0)
    .slice(0, 5);
  const maxSpend = topSpenders[0]?.periodUsd ?? 1;

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-[14px] text-muted-foreground mb-1">Spend</p>
          <p className="text-[28px] font-bold tabular-nums text-foreground leading-none tracking-tight">
            {formatCost(spend.totalUsd)}
          </p>
        </div>
        <div className="flex gap-0.5 rounded-lg bg-muted p-0.5 shrink-0">
          {(Object.keys(PERIOD_LABELS) as SpendPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={cn(
                "px-1.5 py-1 rounded-md text-[14px] transition-colors",
                p === period
                  ? "bg-card text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {SHORT_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Horizontal bar chart */}
      {topSpenders.length > 0 && (
        <div className="space-y-2.5">
          {topSpenders.map((s) => {
            const agent = agentMap.get(s.agentId);
            const pct = (s.periodUsd / maxSpend) * 100;
            return (
              <div key={s.agentId}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[14px] text-foreground truncate">
                    {agent?.name ?? "Unknown"}
                  </span>
                  <span className="text-[14px] font-medium tabular-nums text-foreground ml-2 shrink-0">
                    {formatCost(s.periodUsd)}
                  </span>
                </div>
                <div
                  className="h-2 rounded-full bg-accent"
                  style={{ width: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ComputeResources({ agents }: { agents: AgentView[] }) {
  const sandboxes = useMemo(
    () => agents.filter((a) => !a.kind),
    [agents],
  );

  const running = sandboxes.filter((a) => a.state === "running").length;
  const hibernating = sandboxes.filter(
    (a) => a.state === "hibernated",
  ).length;
  const errored = sandboxes.filter((a) => a.state === "error").length;
  const total = sandboxes.length;
  const maxSlots = Math.max(total, 8);

  return (
    <div className="rounded-lg border border-border bg-card p-6 flex flex-col">
      {/* Header with inline CTA */}
      <div className="flex items-start justify-between mb-1">
        <p className="text-[14px] text-muted-foreground">
          Compute resources
        </p>
        <button
          type="button"
          className="text-[14px] font-medium text-accent hover:text-accent/80 transition-colors shrink-0"
        >
          Request more
        </button>
      </div>
      <p className="text-[28px] font-bold tabular-nums text-foreground leading-none tracking-tight mb-5">
        {total}/{maxSlots} slots
      </p>

      {/* Segmented slots */}
      <div className="flex gap-1.5 mb-5">
        {Array.from({ length: maxSlots }).map((_, i) => {
          let color = "bg-muted";
          if (i < running) color = "bg-success";
          else if (i < running + hibernating) color = "bg-muted-foreground/50";
          else if (i < running + hibernating + errored) color = "bg-danger/60";
          return (
            <div
              key={i}
              className={cn("h-4 flex-1 rounded-sm", color)}
            />
          );
        })}
      </div>

      {/* Stat rows */}
      <div className="space-y-2.5 flex-1">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[14px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full bg-success inline-block" />
            Running
          </span>
          <span className="text-[14px] font-medium tabular-nums text-foreground">
            {running}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[14px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/50 inline-block" />
            Hibernating
          </span>
          <span className="text-[14px] font-medium tabular-nums text-foreground">
            {hibernating}
          </span>
        </div>
        {errored > 0 && (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[14px] text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full bg-danger/60 inline-block" />
              Error
            </span>
            <span className="text-[14px] font-medium tabular-nums text-foreground">
              {errored}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[14px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full bg-muted inline-block border border-border" />
            Available
          </span>
          <span className="text-[14px] font-medium tabular-nums text-foreground">
            {maxSlots - total}
          </span>
        </div>
      </div>

      {/* Hibernate action */}
      {running > 0 && (
        <button
          type="button"
          className="mt-4 w-full rounded-md border border-border bg-muted/50 px-3 py-2 text-[14px] font-medium text-foreground hover:bg-muted transition-colors"
        >
          Hibernate all unused
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Approvals — all pending, grouped together, actionable
   ═══════════════════════════════════════════════════════════════════════════ */

function ApprovalsSection({ agents }: { agents: AgentView[] }) {
  const { data: approvals } = usePendingApprovals();
  const approveOnce = useApproveOnce();
  const denyForever = useDenyForever();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  const pending = approvals ?? [];
  if (pending.length === 0) return null;

  const inflight = approveOnce.isPending || denyForever.isPending;

  return (
    <section className="space-y-3" aria-label="Approvals">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">
          Needs approval
        </h2>
        <Badge
          variant="default"
          className="bg-accent text-white hover:bg-accent"
        >
          {pending.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {pending.map((approval) => {
          const agent = agentMap.get(approval.agentId);
          const isNetwork = approval.payload.kind === "ext_authz";
          let title: string;
          let detail: string | null = null;
          if (approval.payload.kind === "ext_authz") {
            title = `${approval.payload.method} ${approval.payload.host}`;
            detail = approval.payload.path;
          } else {
            title = approval.payload.toolName;
          }

          return (
            <div
              key={approval.id}
              className="rounded-lg border border-border bg-surface p-5"
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={() =>
                    navigateToSandboxHome(approval.agentId)
                  }
                  className="text-[14px] font-medium text-foreground hover:text-accent transition-colors truncate"
                >
                  {agent?.name ?? "Unknown"}
                </button>
                <Badge variant={isNetwork ? "info" : "muted"} size="sm">
                  {isNetwork ? "Network" : "Tool"}
                </Badge>
                {agent?.kind && (
                  <Badge variant="muted" size="sm">
                    {agent.kind === "experiment"
                      ? "Experiment"
                      : "Knowledge Base"}
                  </Badge>
                )}
                <span className="ml-auto text-[14px] text-muted-foreground shrink-0">
                  {timeAgo(approval.createdAt)}
                </span>
              </div>

              {/* Request detail */}
              <div className="rounded-md bg-muted/50 px-4 py-3 mb-4">
                <p className="font-mono text-[14px] font-semibold text-foreground">
                  {title}
                </p>
                {detail && (
                  <p className="font-mono text-[14px] text-muted-foreground truncate mt-0.5">
                    {detail}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => approveOnce.mutate({ id: approval.id })}
                  disabled={inflight}
                >
                  Allow
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => denyForever.mutate({ id: approval.id })}
                  disabled={inflight}
                  className="text-danger border-danger/40 hover:bg-danger/10"
                >
                  Deny
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Scheduled Runs
   ═══════════════════════════════════════════════════════════════════════════ */

function ScheduleRunsSection({ agents }: { agents: AgentView[] }) {
  const { data: runs } = useRecentScheduleRuns();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  const recentRuns = runs ?? [];
  if (recentRuns.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="Scheduled Runs">
      <h2 className="text-[18px] font-semibold text-foreground">
        Scheduled runs
      </h2>

      <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
        {recentRuns.map((run) => {
          const agent = agentMap.get(run.agentId);
          const failed = run.status === "failed";
          return (
            <button
              key={run.scheduleId}
              type="button"
              onClick={() => navigateToSandboxHome(run.agentId)}
              className="flex items-start gap-3 px-4 py-3 w-full text-left hover:bg-muted/60 transition-colors"
            >
              <span
                className={cn(
                  "mt-1.5 w-2 h-2 rounded-full shrink-0",
                  failed ? "bg-danger" : "bg-success",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-foreground">
                    {agent?.name ?? "Unknown"}
                  </span>
                  <span className="text-[14px] text-muted-foreground">
                    {run.description}
                  </span>
                </div>
                {run.outputSummary && (
                  <p
                    className={cn(
                      "text-[14px] mt-0.5",
                      failed
                        ? "text-danger"
                        : "text-muted-foreground",
                    )}
                  >
                    {run.outputSummary}
                  </p>
                )}
              </div>
              <span className="text-[14px] tabular-nums text-muted-foreground shrink-0 mt-0.5">
                {timeAgo(run.ranAt)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Artifacts — matches artifact-row.tsx style
   ═══════════════════════════════════════════════════════════════════════════ */

function ArtifactsSection({ agents }: { agents: AgentView[] }) {
  const { data: artifacts } = useArtifacts({});
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const agentMap = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents],
  );

  const recent = useMemo(() => {
    if (!artifacts) return [];
    return artifacts.filter((a) => a.agentId).slice(0, 6);
  }, [artifacts]);

  if (recent.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="Artifacts">
      <h2 className="text-[18px] font-semibold text-foreground">
        New artifacts
      </h2>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {recent.map((artifact) => {
          const agent = agentMap.get(artifact.agentId!);
          return (
            <button
              key={artifact.id}
              type="button"
              onClick={() =>
                navigateToSandboxHome(artifact.agentId!, "artifacts")
              }
              className="flex w-full items-center gap-3 border-t border-border px-4 py-2.5 text-left transition-colors hover:bg-muted/60 first:border-t-0"
            >
              <div className="min-w-0 flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-foreground truncate">
                  {artifact.title}
                </span>
                <span className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                  <span>{agent?.name ?? "Unknown"}</span>
                  <span>{timeAgo(artifact.createdAt)}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Experiments — finished + needs input
   ═══════════════════════════════════════════════════════════════════════════ */

function ExperimentsSection({ agents }: { agents: AgentView[] }) {
  const experiments = useMemo(
    () => agents.filter((a) => a.kind === "experiment"),
    [agents],
  );
  const { data: driverSummaries } = useDriverSummaries({ silent: true });
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const completed = useMemo(() => {
    if (!driverSummaries) return [];
    const results: {
      id: string;
      agentName: string;
      agentId: string;
      name: string;
      createdAt: string;
      failed: boolean;
    }[] = [];

    for (const summary of driverSummaries) {
      const agent = experiments.find(
        (a) => a.id === summary.driverAgentId,
      );
      if (!agent) continue;

      for (const exp of summary.experiments) {
        if (exp.status === "completed" || exp.status === "failed") {
          results.push({
            id: exp.id,
            agentName: agent.name,
            agentId: agent.id,
            name: exp.name,
            createdAt: exp.createdAt,
            failed: exp.status === "failed",
          });
        }
      }
    }

    return results.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }, [driverSummaries, experiments]);

  const blocked = useMemo(
    () =>
      experiments.filter(
        (a) =>
          a.state === "error" ||
          a.overBudget ||
          a.contributionFailures.length > 0,
      ),
    [experiments],
  );

  if (completed.length === 0 && blocked.length === 0) return null;

  return (
    <section className="space-y-4" aria-label="Experiments">
      <h2 className="text-[18px] font-semibold text-foreground">
        Experiments
      </h2>

      {/* Blocked experiments */}
      {blocked.length > 0 && (
        <div className="space-y-2">
          {blocked.map((agent) => {
            let reason = "Unknown issue";
            if (agent.overBudget)
              reason = agent.overBudgetMessage ?? "Exceeded budget limit";
            else if (agent.state === "error")
              reason =
                agent.podTerminationReason ?? agent.error ?? "Crashed";
            else if (agent.contributionFailures.length > 0) {
              const f = agent.contributionFailures[0]!;
              reason = `${f.kind}: ${f.message}`;
            }

            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => navigateToSandboxHome(agent.id)}
                className="rounded-lg border border-danger/40 bg-danger/5 p-4 w-full text-left hover:bg-danger/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-foreground">
                    {agent.name}
                  </span>
                  <Badge variant="danger" size="sm">
                    Needs input
                  </Badge>
                </div>
                <p className="text-[14px] text-danger mt-1">{reason}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Completed experiments */}
      {completed.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
          {completed.map((exp) => (
            <button
              key={exp.id}
              type="button"
              onClick={() => navigateToSandboxHome(exp.agentId)}
              className="flex items-start gap-3 px-4 py-3 w-full text-left hover:bg-muted/60 transition-colors"
            >
              <span
                className={cn(
                  "mt-1.5 w-2 h-2 rounded-full shrink-0",
                  exp.failed ? "bg-danger" : "bg-success",
                )}
              />
              <div className="min-w-0 flex-1">
                <span className="text-[14px] font-medium text-foreground">
                  {exp.name}
                </span>
                <p className="text-[14px] text-muted-foreground mt-0.5">
                  {exp.agentName}
                  {exp.failed && (
                    <span className="text-danger ml-2">failed</span>
                  )}
                </p>
              </div>
              <span className="text-[14px] tabular-nums text-muted-foreground shrink-0 mt-0.5">
                {timeAgo(exp.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Knowledge Bases
   ═══════════════════════════════════════════════════════════════════════════ */

function KnowledgeBaseSection({ agents }: { agents: AgentView[] }) {
  const knowledgeBases = useMemo(
    () => agents.filter((a) => a.kind === "knowledge-base"),
    [agents],
  );
  const { data: kbActivity } = useKbActivity();
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);

  const indexed = useMemo(() => {
    if (!kbActivity) return [];
    return kbActivity
      .filter((a) => a.pagesIndexed > 0 && a.lastIndexedAt)
      .map((a) => ({
        ...a,
        agent: knowledgeBases.find((kb) => kb.id === a.agentId),
      }))
      .filter((a) => a.agent);
  }, [kbActivity, knowledgeBases]);

  const issues = useMemo(
    () =>
      knowledgeBases.filter(
        (a) =>
          a.state === "error" || a.contributionFailures.length > 0,
      ),
    [knowledgeBases],
  );

  if (indexed.length === 0 && issues.length === 0) return null;

  return (
    <section className="space-y-4" aria-label="Knowledge Bases">
      <h2 className="text-[18px] font-semibold text-foreground">
        Knowledge Bases
      </h2>

      {/* Issues */}
      {issues.length > 0 && (
        <div className="space-y-2">
          {issues.map((agent) => {
            let reason = "Error";
            if (agent.contributionFailures.length > 0) {
              const f = agent.contributionFailures[0]!;
              reason = `${f.kind}: ${f.message}`;
            } else if (agent.error) {
              reason = agent.error;
            }
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => openKnowledgeBase(agent.id)}
                className="rounded-lg border border-danger/40 bg-danger/5 p-4 w-full text-left hover:bg-danger/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-foreground">
                    {agent.name}
                  </span>
                  <Badge variant="danger" size="sm">
                    Error
                  </Badge>
                </div>
                <p className="text-[14px] text-danger mt-1">{reason}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Recently indexed */}
      {indexed.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
          {indexed.map((item) => (
            <button
              key={item.agentId}
              type="button"
              onClick={() => openKnowledgeBase(item.agentId)}
              className="flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-muted/60 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <span className="text-[14px] font-medium text-foreground">
                  {item.agent!.name}
                </span>
              </div>
              <span className="text-[14px] font-medium tabular-nums text-success shrink-0">
                +{item.pagesIndexed} page
                {item.pagesIndexed === 1 ? "" : "s"}
              </span>
              <span className="text-[14px] tabular-nums text-muted-foreground shrink-0">
                {timeAgo(item.lastIndexedAt!)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Empty State
   ═══════════════════════════════════════════════════════════════════════════ */

function EmptyState() {
  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Home"
        description="What your agents have been up to, and what needs your attention."
      />
      <div className="mx-auto max-w-lg space-y-6 pt-8">
        <div className="text-center space-y-2">
          <h2 className="text-[20px] font-semibold text-foreground">
            Create your first agent
          </h2>
          <p className="text-[14px] text-muted-foreground">
            Pick a starting point — you can always change configuration later.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <EmptyStateOption
            label="General-purpose sandbox"
            description="Run a harness against a repo with full tool access"
            onClick={() => navigateToCreateSandbox("general-purpose")}
          />
          <EmptyStateOption
            label="Experiment"
            description="Sweep prompts, models, or parameters and compare results"
            onClick={() => navigateToCreateSandbox("experiment")}
          />
          <EmptyStateOption
            label="Knowledge base"
            description="Build a persistent wiki from docs, code, or conversations"
            onClick={() => navigateToCreateSandbox("knowledge-base")}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyStateOption({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border bg-card px-5 py-4 text-left transition-colors hover:border-accent hover:bg-muted/50"
    >
      <p className="text-[15px] font-medium text-foreground">{label}</p>
      <p className="text-[14px] text-muted-foreground mt-0.5">
        {description}
      </p>
    </button>
  );
}
