import { Component, type ReactNode, useEffect, useMemo, useState } from "react";

import { ListSkeleton } from "@/components/list-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { ApprovalHistorySection } from "../components/approval-history-section.js";
import { BlockedSection } from "../components/blocked-section.js";
import { HomeHeader } from "../components/home-header.js";
import { ReadySection } from "../components/ready-section.js";
import { ResultsSection } from "../components/results-section.js";
import { RunningSection } from "../components/running-section.js";

class SectionBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div style={{ padding: 16, border: "1px solid red", borderRadius: 8, margin: "8px 0" }}>
          <strong style={{ color: "red" }}>[{this.props.name}] crashed:</strong>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
            {this.state.error.message}
          </pre>
        </div>
      );
    return this.props.children;
  }
}
import {
  formatCost,
  type SpendPeriod,
  useAgentRows,
  useSpendOverview,
} from "../home-data.js";
import { markVisitNow } from "../home-digest-store.js";

/* ═══════════════════════════════════════════════════════════════════════════
   Home Page
   ═══════════════════════════════════════════════════════════════════════════ */

export function HomeView() {
  const { agentsData, initialLoaded } = useAgentRows();
  const agents = agentsData?.list ?? [];

  useEffect(() => {
    return () => {
      markVisitNow();
    };
  }, []);

  if (!initialLoaded) {
    return (
      <div className="space-y-8">
        <HomeHeader />
        <ListSkeleton rows={4} rowHeight={56} />
      </div>
    );
  }

  if (agents.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-10">
      <HomeHeader />

      {/* Blocked — most urgent, shown first */}
      <SectionBoundary name="BlockedSection">
        <BlockedSection />
      </SectionBoundary>

      {/* Usage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SpendChart agents={agents} />
        <ComputeResources agents={agents} />
      </div>

      {/* Running now — filterable dashboard */}
      <SectionBoundary name="RunningSection">
        <RunningSection />
      </SectionBoundary>

      {/* Outputs ready for review */}
      <SectionBoundary name="ReadySection">
        <ReadySection />
      </SectionBoundary>

      {/* What happened */}
      <ResultsSection />

      {/* Recent approval decisions */}
      <SectionBoundary name="ApprovalHistorySection">
        <ApprovalHistorySection />
      </SectionBoundary>
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

  const dailyRate =
    period === "today"
      ? spend.totalUsd
      : period === "week"
        ? spend.totalUsd / 7
        : period === "month"
          ? spend.totalUsd / 30
          : spend.totalUsd / 365;

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-[14px] text-muted-foreground mb-1">Spend</p>
          <p className="text-[28px] font-bold tabular-nums text-foreground leading-none tracking-tight">
            {formatCost(spend.totalUsd)}
          </p>
          <p className="text-[14px] text-muted-foreground mt-1">
            ~{formatCost(dailyRate)}/day
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
          else if (i < running + hibernating) color = "bg-muted-foreground";
          else if (i < running + hibernating + errored) color = "bg-danger";
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
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground inline-block" />
            Hibernating
          </span>
          <span className="text-[14px] font-medium tabular-nums text-foreground">
            {hibernating}
          </span>
        </div>
        {errored > 0 && (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[14px] text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full bg-danger inline-block" />
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

    </div>
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
            label="General-purpose coding agent"
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
