import {
  Book,
  Checkmark,
  Chemistry,
  ChevronDown,
  Code,
  Document,
  OverflowMenuVertical,
  Time,
} from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";

import { ListSkeleton } from "@/components/list-skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PageShell } from "./_shell";

const meta: Meta = {
  title: "Pages/Home",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

/* ── Working dots animation (matches sessions/components/working-dots) ── */

function WorkingDots({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const dotSize = size === "sm" ? "size-1.5" : "size-2";
  return (
    <span
      className={cn(
        "working-dots inline-flex items-center -space-x-[1px]",
        className,
      )}
    >
      <span
        className={cn(
          dotSize,
          "rounded-full border-[1.5px] border-background bg-current",
        )}
      />
      <span
        className={cn(
          dotSize,
          "rounded-full border-[1.5px] border-background bg-current",
        )}
      />
      <span
        className={cn(
          dotSize,
          "rounded-full border-[1.5px] border-background bg-current",
        )}
      />
    </span>
  );
}

/* ── Feed card components (match comparison-view.tsx on main) ─────────── */

function FeedActiveCard({
  icon,
  agentName,
  title,
  duration,
  statsPill,
  scheduled,
}: {
  icon: React.ReactNode;
  agentName: string;
  title: string;
  duration: string;
  statsPill?: React.ReactNode;
  scheduled?: boolean;
}) {
  return (
    <button
      type="button"
      className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200 hover:shadow-lg"
    >
      <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
        {icon}
        <span>{agentName}</span>
      </div>
      <p className="text-[15px] font-semibold text-foreground leading-snug">
        {title}
        <WorkingDots
          className="text-blue-500 inline-flex align-middle ml-1"
          size="md"
        />
      </p>
      {statsPill}
      <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] text-muted-foreground">{duration}</span>
          {scheduled && (
            <span className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-all cursor-pointer">
              · Edit schedule
            </span>
          )}
        </div>
        <span className="w-[24px] text-center text-muted-foreground/20 transition-all duration-200 group-hover:text-foreground group-hover:translate-x-0.5">
          →
        </span>
      </div>
    </button>
  );
}

function FeedFinishedCard({
  icon,
  agentName,
  title,
  time,
  unread,
  artifact,
  statsPill,
  scheduled,
}: {
  icon: React.ReactNode;
  agentName: string;
  title: string;
  time: string;
  unread: boolean;
  artifact?: { name: string };
  statsPill?: React.ReactNode;
  scheduled?: boolean;
}) {
  return (
    <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200 cursor-pointer hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
            {icon}
            <span>{agentName}</span>
          </div>
          <p className="text-[15px] font-semibold text-foreground leading-snug">
            {title}
            {unread && (
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 align-middle ml-1.5" />
            )}
          </p>
        </div>
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground hover:text-foreground transition-all shrink-0"
        >
          Dismiss
        </button>
      </div>
      {statsPill}
      {artifact && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border/50 bg-muted/40 hover:bg-muted/70 hover:border-border transition-all text-[14px] text-muted-foreground hover:text-foreground mt-3"
        >
          <Document size={16} className="shrink-0" />
          <span className="truncate max-w-[160px]">{artifact.name}</span>
        </button>
      )}
      <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] text-muted-foreground">{time}</span>
          {scheduled && (
            <span className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-all cursor-pointer">
              · Edit schedule
            </span>
          )}
        </div>
        <span className="w-[24px] text-center text-muted-foreground/20 transition-all duration-200 group-hover:text-foreground group-hover:translate-x-0.5">
          →
        </span>
      </div>
    </div>
  );
}

function FeedApprovalCard({
  agentName,
  label,
  detail,
}: {
  agentName: string;
  label: string;
  detail: string;
}) {
  return (
    <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <span>{agentName}</span>
          </div>
          <p className="text-[15px] font-semibold text-foreground leading-snug">
            {label}
          </p>
        </div>
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground hover:text-foreground transition-all shrink-0"
        >
          Dismiss
        </button>
      </div>
      <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
        <span className="font-mono text-[14px] text-muted-foreground">
          {detail}
        </span>
      </div>
      <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
        <span className="text-[14px] text-muted-foreground">just now</span>
        <div className="flex items-center gap-2">
          <Button size="sm">Allow</Button>
          <Button variant="outline" size="sm" className="px-2">
            <OverflowMenuVertical size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ExperimentPill({
  runs,
  status,
  statusColor,
}: {
  runs: string;
  status?: string;
  statusColor?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
      <span className="text-[14px] text-muted-foreground tabular-nums">
        {runs}
      </span>
      {status && (
        <>
          <span className="text-[14px] text-muted-foreground/40">·</span>
          <span
            className={cn(
              "text-[14px] tabular-nums",
              statusColor || "text-muted-foreground",
            )}
          >
            {status}
          </span>
        </>
      )}
    </div>
  );
}

/* ── Sidebar widgets ──────────────────────────────────────────────────── */

function ComputeWidget() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-[14px] font-semibold text-foreground">Compute</p>
      <p className="mt-2 text-[24px] font-semibold text-foreground">8 CPU</p>
      <p className="mt-0.5 text-[14px] text-muted-foreground">8 Gi memory</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-[35%] rounded-full bg-primary" />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        35% of 24 CPU limit
      </p>
    </div>
  );
}

function SpendWidget() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-[14px] font-semibold text-foreground">Spend</p>
      <p className="mt-2 text-[24px] font-semibold text-foreground">$142.50</p>
      <p className="mt-0.5 text-[14px] text-muted-foreground">This month</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-[28%] rounded-full bg-primary" />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        28% of $500 budget
      </p>
    </div>
  );
}

function ScheduleWidget() {
  const schedules = [
    {
      name: "Daily brand audit",
      agentName: "brand-asset-generator",
      cadence: "Every weekday at 9:00 AM",
      nextRun: "in 3h",
      lastResult: "success" as const,
    },
    {
      name: "Nightly test suite",
      agentName: "backend-refactor",
      cadence: "Every day at 2:00 AM",
      nextRun: "in 14h",
      lastResult: "failed" as const,
    },
    {
      name: "Weekly report generation",
      agentName: "reporting-agent",
      cadence: "Every Monday at 8:00 AM",
      nextRun: "in 2d",
      lastResult: "success" as const,
    },
    {
      name: "Dependency vulnerability scan",
      agentName: "security-scanner",
      cadence: "Every 6 hours",
      nextRun: "in 4h",
      lastResult: "success" as const,
    },
    {
      name: "Performance benchmark",
      agentName: "perf-monitor",
      cadence: "Every day at 3:00 AM",
      nextRun: "in 15h",
      lastResult: "success" as const,
    },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-foreground">
          Schedules
          <span className="text-[14px] font-normal text-muted-foreground ml-1.5">
            (10)
          </span>
        </h3>
        <button
          type="button"
          className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
        >
          See all
        </button>
      </div>
      <div className="space-y-0.5">
        {schedules.map((s) => (
          <button
            key={s.name}
            type="button"
            className="group w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50"
          >
            <span
              className={cn(
                "w-2 h-2 rounded-full shrink-0",
                s.lastResult === "failed" ? "bg-destructive" : "bg-emerald-500",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] text-foreground truncate">{s.name}</p>
              <p className="text-[14px] text-muted-foreground truncate">
                {s.agentName} · {s.cadence}
              </p>
            </div>
            <span className="text-[14px] text-muted-foreground tabular-nums shrink-0">
              {s.nextRun}
            </span>
            <span className="text-muted-foreground/20 group-hover:text-foreground transition-colors">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Stories ───────────────────────────────────────────────────────────── */

export const Populated: Story = {
  render: () => (
    <PageShell activeNav="home" maxWidth="1200">
      <div className="pb-4">
        <p className="text-[18px] text-muted-foreground mb-1">Good morning</p>
        <h1 className="text-[40px] font-bold tracking-[-1px] text-foreground leading-none">
          Activity
        </h1>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
        {/* LEFT: Feed */}
        <div className="space-y-3">
          {/* Filter + stats */}
          <div className="flex items-center justify-between pb-1">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            >
              All <ChevronDown size={14} />
            </button>
            <div className="flex items-center gap-4">
              <p className="text-[14px] text-muted-foreground tabular-nums">
                <span className="text-foreground font-medium">4</span> running
                <span className="text-border mx-1.5">·</span>
                <span className="text-foreground font-medium">7</span> to review
              </p>
              <button
                type="button"
                className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            </div>
          </div>

          {/* Approval card */}
          <FeedApprovalCard
            agentName="frontend-agent"
            label="Wants to access network"
            detail="GET api.stripe.com"
          />

          {/* Active cards */}
          <FeedActiveCard
            icon={<Code size={16} className="shrink-0" />}
            agentName="frontend-agent"
            title="Implement dark mode toggle"
            duration="12m"
          />
          <FeedActiveCard
            icon={<Book size={16} className="shrink-0" />}
            agentName="market-research-kb"
            title="Research competitor pricing models"
            duration="5m"
          />
          <FeedActiveCard
            icon={<Time size={16} className="shrink-0" />}
            agentName="perf-testing-agent"
            title="Weekly performance regression sweep"
            duration="6m"
            scheduled
            statsPill={
              <ExperimentPill
                runs="24 runs"
                status="2 live"
                statusColor="text-blue-500"
              />
            }
          />
          <FeedActiveCard
            icon={<Time size={16} className="shrink-0" />}
            agentName="maintenance-bot"
            title="Nightly dependency check"
            duration="3m"
            scheduled
          />

          {/* Finished cards */}
          <FeedFinishedCard
            icon={<Code size={16} className="shrink-0" />}
            agentName="backend-refactor"
            title="Refactor auth middleware"
            time="45m ago"
            unread
          />
          <FeedFinishedCard
            icon={<Code size={16} className="shrink-0" />}
            agentName="copywriting-agent"
            title="Generate marketing copy"
            time="1h ago"
            unread
            artifact={{ name: "campaign-copy-v3.md" }}
          />
          <FeedFinishedCard
            icon={<Book size={16} className="shrink-0" />}
            agentName="market-research-kb"
            title="Research competitor pricing models"
            time="30m ago"
            unread
          />
          <FeedFinishedCard
            icon={<Time size={16} className="shrink-0" />}
            agentName="maintenance-bot"
            title="Nightly dependency check"
            time="3h ago"
            unread
            scheduled
          />
          <FeedFinishedCard
            icon={<Time size={16} className="shrink-0" />}
            agentName="brand-asset-generator"
            title="Daily brand audit"
            time="6h ago"
            unread
            scheduled
            artifact={{ name: "brand-audit-jun14.pdf" }}
          />
          <FeedFinishedCard
            icon={<Chemistry size={16} className="shrink-0" />}
            agentName="perf-testing-agent"
            title="Weekly performance regression sweep"
            time="12h ago"
            unread
            scheduled
            artifact={{ name: "perf-regression-report" }}
            statsPill={<ExperimentPill runs="86 runs completed" />}
          />
          <FeedFinishedCard
            icon={<Chemistry size={16} className="shrink-0" />}
            agentName="color-palette-testing"
            title="Spring palette — warm vs cool"
            time="10h ago"
            unread
            artifact={{ name: "experiment-dashboard" }}
            statsPill={<ExperimentPill runs="120 runs completed" />}
          />
        </div>

        {/* RIGHT: Sidebar */}
        <div className="space-y-4 pt-[37px]">
          <ComputeWidget />
          <SpendWidget />
          <ScheduleWidget />
        </div>
      </div>
    </PageShell>
  ),
};

export const Loading: Story = {
  render: () => (
    <PageShell activeNav="home" maxWidth="1200">
      <div className="pb-4">
        <p className="text-[18px] text-muted-foreground mb-1">Good morning</p>
        <h1 className="text-[40px] font-bold tracking-[-1px] text-foreground leading-none">
          Activity
        </h1>
      </div>
      <div className="mt-6">
        <ListSkeleton rows={4} rowHeight={56} />
      </div>
    </PageShell>
  ),
};
