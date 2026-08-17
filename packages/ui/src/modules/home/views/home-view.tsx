import {
  Add,
  Book,
  Checkmark,
  Chemistry,
  ChevronDown,
  Close,
  Code,
  ContainerSoftware,
  Document,
  Filter,
  OverflowMenuVertical,
  Time,
} from "@carbon/icons-react";
import { Children, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import { ListSkeleton } from "@/components/list-skeleton";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { type DemoState, useDemoState } from "../../../mock/demo-state.js";
import { useStore } from "../../../store.js";
import { usePendingApprovals } from "../../approvals/api/queries.js";
import { ScheduleFormModal } from "../../schedules/forms/schedule-form-modal.js";
import { WorkingDots } from "../../sessions/components/working-dots.js";
import { HomeHeader } from "../components/home-header.js";
import { useAgentRows } from "../home-data.js";
import { markVisitNow } from "../home-digest-store.js";
import {
  ApprovalVariant1,
  ArtifactCard,
  ComputePreview,
  ExperimentCard,
  SessionFinishedCard,
  SessionRunningCard,
} from "./comparison-view.js";
/* ═══════════════════════════════════════════════════════════════════════════
   Home Page
   ═══════════════════════════════════════════════════════════════════════════ */

type HomeLayout = "bento2" | "bento3" | "feed";

export function HomeView() {
  const { agentsData, initialLoaded } = useAgentRows();
  const agents = agentsData?.list ?? [];
  const { data: pendingApprovals } = usePendingApprovals();
  const approvals = useMemo(() => pendingApprovals ?? [], [pendingApprovals]);
  const { state: demoState } = useDemoState();
  const [layout, setLayout] = useState<HomeLayout>("bento2");
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

  if (agents.length === 0 && !import.meta.env.VITE_MOCK) {
    return <EmptyState />;
  }

  const populatedState = demoState === "empty" ? "active-blockers" : demoState;

  return (
    <div className="space-y-6">
      {import.meta.env.VITE_MOCK && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-accent/40 bg-accent/5 px-3 py-2">
          <span className="text-[14px] text-muted-foreground font-medium mr-1">Layout:</span>
          {(
            [
              { key: "bento2", label: "Current" },
              { key: "bento3", label: "Refined" },
              { key: "feed", label: "Feed" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setLayout(opt.key)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[14px] font-medium transition-colors",
                layout === opt.key
                  ? "bg-accent text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {layout === "bento2" && <BentoHomeLayout2 demoState={demoState} />}
      {layout === "bento3" && <BentoHomeLayout3 demoState={demoState} />}
      {layout === "feed" && <FeedDashboardLayout />}
    </div>
  );
}

import type { ApprovalView } from "api-server-api";

export function StackedCards({
  children,
  label,
  visibleCount = 3,
}: {
  children: ReactNode;
  label: string;
  visibleCount?: number;
}) {
  const items = Children.toArray(children);
  const [expanded, setExpanded] = useState(false);
  const visible = items.slice(0, visibleCount);
  const remaining = items.length - visibleCount;

  if (items.length === 0) return null;

  if (expanded) {
    return (
      <div className="space-y-3">
        {items}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Collapse
        </button>
      </div>
    );
  }

  const leadCards = visible.slice(
    0,
    remaining > 0 ? visibleCount - 1 : visibleCount,
  );
  const lastVisible = visible[visibleCount - 1];

  return (
    <div className="space-y-3">
      {leadCards.map((item, i) => (
        <div key={i}>{item}</div>
      ))}
      {remaining > 0 && lastVisible && (
        <>
          <div className="relative mb-5">
            {remaining >= 2 && (
              <div className="absolute -bottom-3 left-3 right-3 h-3 rounded-b-lg border border-t-0 border-border bg-card/40" />
            )}
            {remaining >= 1 && (
              <div className="absolute -bottom-1.5 left-1.5 right-1.5 h-3 rounded-b-lg border border-t-0 border-border bg-card/70" />
            )}
            <div className="relative z-10">{lastVisible}</div>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            +{remaining} more {label}
          </button>
        </>
      )}
      {remaining <= 0 && lastVisible && <div>{lastVisible}</div>}
    </div>
  );
}

type BlockedFilter = "all" | "network" | "tool";

const BLOCKED_FILTER_OPTIONS: { value: BlockedFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "network", label: "Network" },
  { value: "tool", label: "Tool" },
];

function BlockedTypeFilter({
  value,
  onChange,
}: {
  value: BlockedFilter;
  onChange: (v: BlockedFilter) => void;
}) {
  const label =
    BLOCKED_FILTER_OPTIONS.find((o) => o.value === value)?.label ?? "All types";
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {label}
        <ChevronDown
          size={16}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-md py-1 min-w-[100px]">
            {BLOCKED_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-[14px] transition-colors",
                  value === opt.value
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BlockedSectionFiltered({
  approvals,
  onDismiss,
}: {
  approvals: ApprovalView[];
  onDismiss: (id: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<BlockedFilter>("all");

  const filtered = useMemo(() => {
    return approvals.filter((row) => {
      if (typeFilter === "network" && row.payload.kind !== "ext_authz")
        return false;
      if (typeFilter === "tool" && row.payload.kind !== "acp_native")
        return false;
      return true;
    });
  }, [approvals, typeFilter]);

  return (
    <section className="rounded-2xl border border-destructive/30 bg-gradient-to-br from-destructive/5 to-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-foreground">
          <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />
          <span>
            Needs attention{" "}
            <span className="text-[14px] font-normal text-muted-foreground">
              ({filtered.length})
            </span>
          </span>
        </h2>
        <BlockedTypeFilter value={typeFilter} onChange={setTypeFilter} />
      </div>
      {filtered.length > 0 ? (
        <BlockedCardsStacked approvals={filtered} onDismiss={onDismiss} />
      ) : (
        <p className="text-[14px] text-muted-foreground">
          No approvals match filters.
        </p>
      )}
    </section>
  );
}

function BlockedCardsStacked({
  approvals,
  onDismiss,
}: {
  approvals: ApprovalView[];
  onDismiss?: (id: string) => void;
}) {
  if (approvals.length === 0) return null;
  return (
    <StackedCards label="blocked" visibleCount={1}>
      {approvals.map((row) => (
        <ApprovalVariant1 key={row.id} row={row} onDismiss={onDismiss} />
      ))}
    </StackedCards>
  );
}

export type CardType =
  | "all"
  | "sessions"
  | "experiments"
  | "schedules"
  | "artifacts";

export interface MockCard {
  type: "session" | "experiment" | "schedule" | "artifact";
  ageMinutes: number;
  element: ReactNode;
}

export const RUNNING_CARDS: MockCard[] = [
  {
    type: "session",
    ageMinutes: 12,
    element: (
      <SessionRunningCard
        title="Implement dark mode toggle"
        agentName="frontend-agent"
        updatedAt="12m ago"
      />
    ),
  },
  {
    type: "experiment",
    ageMinutes: 45,
    element: (
      <ExperimentCard
        agentName="color-palette-testing"
        experimentName="Spring palette — warm vs cool tones"
        status="running"
        runningInvocations={3}
      />
    ),
  },
];

interface ReadyCardData {
  type: "session" | "experiment" | "schedule" | "artifact";
  render: (onDismiss: () => void) => ReactNode;
}

export const READY_CARD_DATA: ReadyCardData[] = [
  {
    type: "session",
    render: (onDismiss) => (
      <SessionFinishedCard
        title="Refactor auth middleware"
        agentName="backend-refactor"
        updatedAt="45m ago"
        scheduled={false}
        onDismiss={onDismiss}
      />
    ),
  },
  {
    type: "artifact",
    render: (onDismiss) => (
      <ArtifactCard
        title="Spring campaign hero images"
        agentName="brand-asset-generator"
        updatedAt="2h ago"
        onDismiss={onDismiss}
      />
    ),
  },
  {
    type: "session",
    render: (onDismiss) => (
      <SessionFinishedCard
        title="Daily brand audit"
        agentName="brand-asset-generator"
        updatedAt="6h ago"
        scheduled={true}
        onDismiss={onDismiss}
      />
    ),
  },
  {
    type: "artifact",
    render: (onDismiss) => (
      <ArtifactCard
        title="Nightly performance report"
        agentName="reporting-agent"
        updatedAt="8h ago"
        onDismiss={onDismiss}
      />
    ),
  },
  {
    type: "experiment",
    render: (onDismiss) => (
      <ExperimentCard
        agentName="color-palette-testing"
        experimentName="Spring palette — warm vs cool tones"
        status="completed"
        runningInvocations={0}
        completedRuns={5}
        onDismiss={onDismiss}
      />
    ),
  },
];

const SCHEDULED_CARDS = [
  { name: "Daily brand audit", cadence: "Every weekday at 9:00 AM", nextRun: "in 3h", lastResult: "success", enabled: true, agentName: "brand-asset-generator" },
  { name: "Nightly test suite", cadence: "Every day at 2:00 AM", nextRun: "in 14h", lastResult: "failed", enabled: true, agentName: "backend-refactor" },
  { name: "Weekly report generation", cadence: "Every Monday at 8:00 AM", nextRun: "in 2d", lastResult: "success", enabled: true, agentName: "reporting-agent" },
  { name: "Dependency vulnerability scan", cadence: "Every 6 hours", nextRun: "in 4h", lastResult: "success", enabled: true, agentName: "security-scanner" },
  { name: "Performance benchmark", cadence: "Every day at 3:00 AM", nextRun: "in 15h", lastResult: "success", enabled: true, agentName: "perf-monitor" },
  { name: "Data pipeline sync", cadence: "Every 30 minutes", nextRun: "in 12m", lastResult: "success", enabled: true, agentName: "data-pipeline" },
  { name: "Slack digest summary", cadence: "Every weekday at 5:00 PM", nextRun: "in 7h", lastResult: "success", enabled: true, agentName: "reporting-agent" },
  { name: "Model fine-tune checkpoint", cadence: "Every 12 hours", nextRun: "in 8h", lastResult: "success", enabled: false, agentName: "ml-trainer" },
  { name: "Stale PR cleanup", cadence: "Every Friday at 4:00 PM", nextRun: "in 4d", lastResult: "success", enabled: true, agentName: "backend-refactor" },
  { name: "Cost anomaly detector", cadence: "Every hour", nextRun: "in 45m", lastResult: "failed", enabled: true, agentName: "cost-monitor" },
];

const CARD_TYPE_OPTIONS: { value: CardType; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "sessions", label: "Sessions" },
  { value: "experiments", label: "Experiments" },
  { value: "schedules", label: "Schedules" },
  { value: "artifacts", label: "Artifacts" },
];

function CardTypeFilter({
  value,
  onChange,
}: {
  value: CardType;
  onChange: (v: CardType) => void;
}) {
  const label =
    CARD_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? "All types";
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {label}
        <ChevronDown
          size={16}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-md py-1 min-w-[120px]">
            {CARD_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-[14px] transition-colors",
                  value === opt.value
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function filterCards(
  cards: MockCard[],
  filter: CardType,
): ReactNode[] {
  if (filter === "all") return cards.map((c) => c.element);
  const typeMap: Record<CardType, string> = {
    all: "",
    sessions: "session",
    experiments: "experiment",
    schedules: "schedule",
    artifacts: "artifact",
  };
  return cards
    .filter((c) => c.type === typeMap[filter])
    .map((c) => c.element);
}

function RunningSection() {
  const [filter, setFilter] = useState<CardType>("all");
  const filtered = filterCards(RUNNING_CARDS, filter);

  return (
    <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[16px] font-semibold text-foreground">
          Active{" "}
          <span className="text-[14px] font-normal text-muted-foreground">
            ({filtered.length})
          </span>
        </h2>
        <CardTypeFilter value={filter} onChange={setFilter} />
      </div>
      {filtered.length > 0 ? (
        <StackedCards label="running">
          {filtered.map((el, i) => (
            <div key={i}>{el}</div>
          ))}
        </StackedCards>
      ) : (
        <p className="text-[14px] text-muted-foreground">
          No items match filter.
        </p>
      )}
    </section>
  );
}

function ReadySection() {
  const [filter, setFilter] = useState<CardType>("all");
  const [dismissedIndices, setDismissedIndices] = useState<Set<number>>(
    new Set(),
  );

  const dismiss = (cardIndex: number) => {
    setDismissedIndices((prev) => {
      const next = new Set(prev);
      next.add(cardIndex);
      return next;
    });
  };

  const dismissAll = () => {
    setDismissedIndices(new Set(READY_CARD_DATA.map((_, i) => i)));
  };

  const visibleCards = READY_CARD_DATA.filter(
    (_, i) => !dismissedIndices.has(i),
  );

  const filteredCards = visibleCards.filter((card) => {
    if (filter === "all") return true;
    const typeMap: Record<CardType, string> = {
      all: "",
      sessions: "session",
      experiments: "experiment",
      schedules: "schedule",
      artifacts: "artifact",
    };
    return card.type === typeMap[filter];
  });

  if (visibleCards.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
        <h2 className="text-[16px] font-semibold text-foreground mb-3">
          Ready for review
        </h2>
        <div className="flex items-center gap-2">
          <Checkmark size={16} className="text-success shrink-0" />
          <span className="text-[14px] text-muted-foreground">
            All caught up
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[16px] font-semibold text-foreground">
          Ready for review{" "}
          <span className="text-[14px] font-normal text-muted-foreground">
            ({filteredCards.length})
          </span>
        </h2>
        <div className="flex items-center gap-3">
          <CardTypeFilter value={filter} onChange={setFilter} />
          <button
            type="button"
            onClick={dismissAll}
            className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss all
          </button>
        </div>
      </div>
      {filteredCards.length > 0 ? (
        <StackedCards label="items" visibleCount={3}>
          {filteredCards.map((card, i) => (
            <div key={i}>
              {card.render(() => {
                const originalIndex = READY_CARD_DATA.indexOf(card);
                dismiss(originalIndex);
              })}
            </div>
          ))}
        </StackedCards>
      ) : (
        <p className="text-[14px] text-muted-foreground">
          No items match filter.
        </p>
      )}
    </section>
  );
}

function ScheduledSection() {
  const [modalOpen, setModalOpen] = useState(false);

  const sorted = [...SCHEDULED_CARDS].sort((a, b) => {
    const parse = (t: string) => {
      const num = parseInt(t);
      if (t.includes("m")) return num;
      if (t.includes("h")) return num * 60;
      if (t.includes("d")) return num * 60 * 24;
      return num;
    };
    return parse(a.nextRun) - parse(b.nextRun);
  });

  const top5 = sorted.slice(0, 5);

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-semibold text-foreground">
            Schedules
            <span className="text-[14px] font-normal text-muted-foreground ml-1.5">
              ({sorted.length})
            </span>
          </h3>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            See all
          </button>
        </div>

        <div className="space-y-0.5">
          {top5.map((s, i) => (
            <button
              key={i}
              type="button"
              className="group w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50"
            >
              <span className={cn(
                "w-2 h-2 rounded-full shrink-0",
                s.lastResult === "failed" ? "bg-destructive" : "bg-emerald-500",
              )} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-foreground truncate">{s.name}</p>
                <p className="text-[14px] text-muted-foreground truncate">{s.agentName} · {s.cadence}</p>
              </div>
              <span className="text-[14px] text-muted-foreground tabular-nums shrink-0">
                {s.nextRun}
              </span>
              <span className="text-muted-foreground/20 group-hover:text-foreground transition-colors">→</span>
            </button>
          ))}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModalOpen(false)} />
          <div className="relative z-10 w-full max-w-[520px] max-h-[70vh] rounded-2xl border border-border bg-card shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="text-[16px] font-semibold text-foreground">
                All schedules
                <span className="text-[14px] font-normal text-muted-foreground ml-1.5">
                  ({sorted.length})
                </span>
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Close size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-2 py-2">
              {sorted.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="group w-full flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <span className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    s.lastResult === "failed" ? "bg-destructive" : "bg-emerald-500",
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-foreground truncate">{s.name}</p>
                    <p className="text-[14px] text-muted-foreground truncate">{s.agentName} · {s.cadence}</p>
                  </div>
                  <span className="text-[14px] text-muted-foreground tabular-nums shrink-0">
                    {s.nextRun}
                  </span>
                  <span className="text-muted-foreground/20 group-hover:text-foreground transition-colors">→</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Bento Home Layouts — shared data
   ═══════════════════════════════════════════════════════════════════════════ */

type ReviewSession = {
  title: string;
  agent: string;
  time: string;
  scheduled?: boolean;
  artifact?: { name: string; fileType: string };
  experiment?: { runs: number; best: string; variants: number };
};

const REVIEW_SESSIONS: ReviewSession[] = [
  // Coding Agent — Finished
  { title: "Refactor auth middleware", agent: "backend-refactor", time: "45m ago" },
  // Coding Agent — Finished with artifact
  { title: "Generate marketing copy", agent: "copywriting-agent", time: "1h ago", artifact: { name: "campaign-copy-v3.md", fileType: "MD" } },
  // Coding Agent — Session Finished
  { title: "Research competitor pricing models", agent: "market-research-kb", time: "30m ago" },
  // Scheduled — Session Finished
  { title: "Nightly dependency check", agent: "maintenance-bot", time: "3h ago", scheduled: true },
  // Scheduled — Session Finished with artifact
  { title: "Daily brand audit", agent: "brand-asset-generator", time: "6h ago", scheduled: true, artifact: { name: "brand-audit-jun14.pdf", fileType: "PDF" } },
  // Scheduled — Experiment Finished with dashboard
  { title: "Weekly performance regression sweep", agent: "perf-testing-agent", time: "12h ago", scheduled: true, experiment: { runs: 86, best: "0.94", variants: 2 }, artifact: { name: "perf-regression-report", fileType: "HTML" } },
  // Experiment — Finished with dashboard
  { title: "Spring palette — warm vs cool", agent: "color-palette-testing", time: "10h ago", experiment: { runs: 120, best: "0.87", variants: 3 }, artifact: { name: "experiment-dashboard", fileType: "HTML" } },
];


function ExperimentMiniBar({ experiment }: { experiment: NonNullable<ReviewSession["experiment"]> }) {
  return (
    <div className="flex items-center gap-3 mt-1.5 py-1.5 px-2 rounded-md bg-muted/40 border border-border/40">
      <div className="flex items-center gap-1.5">
        <div className="flex gap-px">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={cn("w-[3px] rounded-full", i < 4 ? "bg-amber-500/70 h-[12px]" : "bg-muted-foreground/20 h-[8px]")} style={{ height: `${8 + Math.random() * 8}px` }} />
          ))}
        </div>
        <span className="text-[14px] tabular-nums text-muted-foreground">{experiment.runs} runs</span>
      </div>
      <span className="text-[14px] text-muted-foreground">·</span>
      <span className="text-[14px] tabular-nums font-medium text-foreground">{experiment.best}</span>
      {experiment.variants > 1 && (
        <>
          <span className="text-[14px] text-muted-foreground">·</span>
          <span className="text-[14px] text-muted-foreground">{experiment.variants} variants</span>
        </>
      )}
    </div>
  );
}

const MOCK_PREVIEW_HTML = `<!DOCTYPE html><html><head><style>
body{font-family:system-ui,sans-serif;margin:0;padding:40px;background:#fafafa;color:#1a1a1a}
h1{font-size:24px;font-weight:600;margin:0 0 16px}
p{font-size:15px;line-height:1.6;color:#555;margin:0 0 12px}
.block{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:20px;margin:16px 0}
code{font-size:13px;background:#f0f0f0;padding:2px 6px;border-radius:4px}
</style></head><body>
<h1>Analysis Report</h1>
<p>This artifact was generated by the agent during the session. It contains a summary of findings and recommendations.</p>
<div class="block"><p><strong>Key findings:</strong></p>
<p>Performance improved by <code>23%</code> after applying the suggested optimizations. Memory usage reduced from 512MB to 380MB under load.</p></div>
<div class="block"><p><strong>Recommendations:</strong></p>
<p>Consider enabling connection pooling and implementing request batching for the remaining endpoints.</p></div>
</body></html>`;

function MockArtifactPreview({ artifact, onClose }: { artifact: { name: string; fileType: string }; onClose: () => void }) {
  return (
    <Modal widthClass="w-[860px]">
      <DialogHeader>{artifact.name}</DialogHeader>
      <DialogBody>
        <div className="mb-3 flex items-center gap-2 font-mono text-[12px] text-muted-foreground">
          <span className="truncate">{artifact.name.replace(/\s/g, "-").toLowerCase()}.{artifact.fileType.toLowerCase()}</span>
          <span>·</span>
          <span>4.0 KB</span>
          <span className="flex-1" />
          <span className="text-[12px] text-muted-foreground/60">v1</span>
        </div>
        <div className="h-[58vh] w-full overflow-hidden rounded border border-border bg-white">
          <iframe
            srcDoc={MOCK_PREVIEW_HTML}
            title={artifact.name}
            className="h-full w-full border-0"
            sandbox="allow-scripts"
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </DialogFooter>
    </Modal>
  );
}

const MOCK_AGENTS_FOR_SCHEDULE = [
  { id: "1", name: "frontend-agent", kind: undefined as string | undefined },
  { id: "2", name: "backend-refactor", kind: undefined as string | undefined },
  { id: "3", name: "brand-asset-generator", kind: undefined as string | undefined },
  { id: "4", name: "market-research-kb", kind: undefined as string | undefined },
  { id: "5", name: "color-palette-testing", kind: "experiment" as string | undefined },
  { id: "6", name: "perf-testing-agent", kind: "experiment" as string | undefined },
];

function kindLabel(kind: string | undefined) {
  if (kind === "experiment") return "Experiment";
  return "Coding Agent";
}

function HomeCreateScheduleModal({ onClose }: { onClose: () => void }) {
  const [selectedAgent, setSelectedAgent] = useState(MOCK_AGENTS_FOR_SCHEDULE[0]!.id);

  const agentPicker = (
    <FormField label="Agent" disableInset>
      <select
        value={selectedAgent}
        onChange={(e) => setSelectedAgent(e.target.value)}
        className="h-[40px] w-full rounded-md border border-border bg-background px-3 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {MOCK_AGENTS_FOR_SCHEDULE.map((a) => (
          <option key={a.id} value={a.id}>{a.name} — {kindLabel(a.kind)}</option>
        ))}
      </select>
    </FormField>
  );

  return (
    <ScheduleFormModal
      agentId={selectedAgent}
      onClose={onClose}
      onSaved={onClose}
      headerSlot={agentPicker}
    />
  );
}

type ActiveSession = {
  title: string;
  agent: string;
  duration: string;
  scheduled?: boolean;
  experiment?: { runs: number; variants: number };
};

const ACTIVE_SESSIONS: ActiveSession[] = [
  // Coding Agent — Running
  { title: "Implement dark mode toggle", agent: "frontend-agent", duration: "12m" },
  // Coding Agent — Running
  { title: "Research competitor pricing models", agent: "market-research-kb", duration: "5m" },
  // Scheduled — Experiment Running
  { title: "Weekly performance regression sweep", agent: "perf-testing-agent", duration: "6m", scheduled: true, experiment: { runs: 24, variants: 2 } },
  // Scheduled — Session Running
  { title: "Nightly dependency check", agent: "maintenance-bot", duration: "3m", scheduled: true },
];

const FEED_CATEGORIES = ["sessions", "experiments", "scheduled"] as const;
type FeedCategory = (typeof FEED_CATEGORIES)[number];
const FEED_CATEGORY_LABELS: Record<FeedCategory, string> = {
  sessions: "Coding Agents",
  experiments: "Experiments",
  scheduled: "Schedules",
};

function feedCategory(item: ReviewSession): FeedCategory {
  if (item.scheduled) return "scheduled";
  if (item.experiment) return "experiments";
  return "sessions";
}

function feedCategoryActive(item: ActiveSession): FeedCategory {
  if (item.scheduled) return "scheduled";
  if (item.experiment) return "experiments";
  return "sessions";
}

function BentoHomeLayout1({ demoState }: { demoState: DemoState }) {
  const [previewArtifact, setPreviewArtifact] = useState<ReviewSession["artifact"] | null>(null);
  const [dismissedReview, setDismissedReview] = useState<Set<number>>(new Set());
  const [feedFilter, setFeedFilter] = useState<FeedCategory[]>([...FEED_CATEGORIES]);
  const [dismissingReview, setDismissingReview] = useState<Set<number>>(new Set());
  const [collapsingReview, setCollapsingReview] = useState<Set<number>>(new Set());
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);

  const dismissReview = useCallback((idx: number) => {
    setDismissingReview(prev => new Set([...prev, idx]));
    setTimeout(() => {
      setCollapsingReview(prev => new Set([...prev, idx]));
    }, 200);
    setTimeout(() => {
      setDismissedReview(prev => new Set([...prev, idx]));
      setDismissingReview(prev => { const next = new Set(prev); next.delete(idx); return next; });
      setCollapsingReview(prev => { const next = new Set(prev); next.delete(idx); return next; });
    }, 500);
  }, []);


  const toggleFeedFilter = useCallback((cat: FeedCategory) => {
    setFeedFilter(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  }, []);

  const isEmptyState = demoState === "empty";
  const isClearedState = demoState === "just-cleared" || demoState === "no-blockers";
  const visibleReview = (isEmptyState || isClearedState) ? [] : REVIEW_SESSIONS.filter((item, i) => !dismissedReview.has(i) && feedFilter.includes(feedCategory(item)));
  const visibleActive = (isEmptyState || isClearedState) ? [] : ACTIVE_SESSIONS.filter(item => feedFilter.includes(feedCategoryActive(item)));
  const allCleared = isClearedState || (!isEmptyState && visibleActive.length === 0 && visibleReview.length === 0);

  const dismissAll = () => {
    const reviewIdxs = REVIEW_SESSIONS.map((_, i) => i).filter(i => !dismissedReview.has(i));
    setDismissingReview(new Set(reviewIdxs));
    setTimeout(() => {
      setCollapsingReview(new Set(reviewIdxs));
    }, 200);
    setTimeout(() => {
      setDismissedReview(new Set(REVIEW_SESSIONS.map((_, i) => i)));
      setDismissingReview(new Set());
      setCollapsingReview(new Set());
    }, 500);
  };

  return (
    <div className="space-y-4">

      {isEmptyState && (
        <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-8">
          <h2 className="text-[20px] font-semibold text-foreground">
            Accelerate research with DAM
          </h2>
          <p className="mt-1.5 max-w-[560px] text-[14px] leading-relaxed text-muted-foreground">
            Run agents in isolated cloud environments with credentials and tools
            securely injected. Create knowledge bases, run experiments to compare
            agent variants, and trigger agents from Slack or on a schedule.
          </p>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <a
              href={import.meta.env.VITE_PROTOTYPE ? "#/agent-setup" : "/agent-setup"}
              className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
                <ContainerSoftware size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">Create a coding agent</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                  Work with your preferred coding agent, credentials, and tools in an isolated environment.
                </p>
              </div>
            </a>
            <a
              href={import.meta.env.VITE_PROTOTYPE ? "#/experiment-onboard" : "/experiment-onboard"}
              className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
                <Chemistry size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">Begin an experiment</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                  Run one goal across many variants at once and compare results.
                </p>
              </div>
            </a>
            <a
              href={import.meta.env.VITE_PROTOTYPE ? "#/kb-setup" : "/kb-setup"}
              className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
                <Book size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">Start a knowledge base</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                  Organize and converse with data sourced from repos, documents, and more (LLM wiki).
                </p>
              </div>
            </a>
          </div>
          <div className="mt-5 flex justify-end">
            <a
              href="https://docs.example.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] font-medium text-accent no-underline hover:underline"
            >
              Or check out the Documentation →
            </a>
          </div>
        </section>
      )}

      {!isEmptyState && (
      <>
      {(visibleActive.length > 0 || visibleReview.length > 0) && (
        <div className="flex items-center justify-between" style={{ maxWidth: "calc(100% - 320px - 16px)" }}>
          <h1 className="text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">Home</h1>
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="xs" className="text-[14px]">
                  <Filter size={16} />
                  {feedFilter.length === FEED_CATEGORIES.length
                    ? "All"
                    : `Filter (${feedFilter.length})`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {FEED_CATEGORIES.map((cat) => (
                  <DropdownMenuCheckboxItem
                    key={cat}
                    checked={feedFilter.includes(cat)}
                    onCheckedChange={() => toggleFeedFilter(cat)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {FEED_CATEGORY_LABELS[cat]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" className="h-8 text-[14px] text-muted-foreground" onClick={dismissAll}>
              Dismiss all
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
        {/* LEFT: Main feed — active + ready for review */}
        <div className="space-y-4">
          {allCleared && (
            <div className="rounded-xl border border-border bg-card p-10 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Checkmark size={16} className="text-emerald-500" />
                <span className="text-[14px] font-medium text-foreground">All clear</span>
              </div>
              <p className="text-[14px] text-muted-foreground">Nothing waiting for review. You're all caught up.</p>
            </div>
          )}

          {/* Active sessions — in progress */}
          {visibleActive.map((item) => {
            const activeIdx = ACTIVE_SESSIONS.indexOf(item);
            return (
            <div key={`active-${activeIdx}`} className="rounded-xl border border-blue-500/30 bg-blue-500/[0.03] p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[14px] font-semibold text-foreground leading-snug flex items-center gap-1.5">
                    {item.scheduled && <Time size={16} className="text-muted-foreground shrink-0" />}
                    {item.title}
                    <WorkingDots className="text-blue-500 inline-flex align-middle" size="md" />
                  </p>
                  <p className="text-[14px] text-muted-foreground mt-1">{item.agent}</p>
                </div>
                <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">{item.duration}</span>
              </div>
              {item.experiment && (
                <div className="flex items-center gap-3 mt-1.5 py-1.5 px-2 rounded-md bg-blue-500/[0.05] border border-blue-500/20">
                  <div className="flex items-center gap-1.5">
                    <div className="flex gap-px">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className={cn("w-[3px] rounded-full", i < 2 ? "bg-blue-500/70" : "bg-muted-foreground/20")} style={{ height: `${8 + i * 2}px` }} />
                      ))}
                    </div>
                    <span className="text-[14px] tabular-nums text-muted-foreground">{item.experiment.runs} runs</span>
                  </div>
                  <span className="text-[14px] text-muted-foreground">·</span>
                  <span className="text-[14px] tabular-nums text-muted-foreground">{item.experiment.variants} variants</span>
                </div>
              )}
              <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-blue-500/20">
                <Button size="sm" variant="outline" className="h-8 text-[14px]">Go to session</Button>
              </div>
            </div>
            );
          })}

          {/* Ready for review sessions */}
          {visibleReview.map((item) => {
            const originalIdx = REVIEW_SESSIONS.indexOf(item);
            return (
            <div key={originalIdx} className={cn(
              "rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3 transition-all duration-300 ease-out",
              dismissingReview.has(originalIdx) && "opacity-0 scale-[0.98]",
              collapsingReview.has(originalIdx) && "!mt-0 !p-0 !border-0 max-h-0 overflow-hidden"
            )}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[14px] font-semibold text-foreground leading-snug flex items-center gap-1.5">
                    {item.scheduled && <Time size={16} className="text-muted-foreground shrink-0" />}
                    {item.title}
                  </p>
                  <p className="text-[14px] text-muted-foreground mt-1.5">{item.agent}</p>
                </div>
                <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">{item.time}</span>
              </div>
              {item.experiment && <ExperimentMiniBar experiment={item.experiment} />}
              {item.artifact && (
                <button
                  type="button"
                  onClick={() => setPreviewArtifact(item.artifact!)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 hover:border-foreground/20 transition-all text-[14px] text-muted-foreground"
                >
                  <Document size={16} className="shrink-0" />
                  <span className="truncate max-w-[160px]">{item.artifact.name}</span>
                  <span className="text-[14px] font-mono opacity-60">{item.artifact.fileType}</span>
                </button>
              )}
              <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
                <Button size="sm" variant="outline" className="h-8 text-[14px]">Go to session</Button>
                <Button size="sm" variant="ghost" className="h-8 text-[14px] text-muted-foreground ml-auto" onClick={() => dismissReview(originalIdx)}>Dismiss</Button>
              </div>
            </div>
            );
          })}
        </div>

        {/* RIGHT: Pinned sidebar */}
        <div className="space-y-3 sticky top-4">
          {/* Needs attention */}
          <div className="rounded-xl border border-destructive/30 bg-gradient-to-br from-destructive/5 to-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-destructive" />
              <h2 className="text-[14px] text-muted-foreground">Needs attention</h2>
            </div>
            <p className="text-[14px] text-foreground font-medium">GET api.figma.com</p>
            <p className="text-[14px] text-muted-foreground">brand-asset-generator · 3m ago</p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="h-7 text-[14px] flex-1">Allow</Button>
              <Button size="sm" variant="ghost" className="h-7 text-[14px] flex-1 text-muted-foreground">Deny</Button>
            </div>
          </div>

          {/* Compute resources */}
          <ComputePreview />

          {/* Scheduled */}
          <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[14px] text-muted-foreground">Scheduled</p>
              <Button variant="outline" size="xs" className="text-[14px]" onClick={() => setShowCreateSchedule(true)}>
                <Add size={16} /> New
              </Button>
            </div>
            <div className="space-y-2.5">
              {SCHEDULED_CARDS.slice(0, 5).map((s, i) => {
                const failed = s.lastResult === "failed";
                return (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-[14px] text-foreground truncate">{s.name}</span>
                    <span className={cn(
                      "text-[14px] tabular-nums shrink-0",
                      failed ? "text-destructive" : "text-muted-foreground",
                    )}>{s.nextRun}</span>
                  </div>
                );
              })}
              <button type="button" className="text-[14px] text-muted-foreground hover:text-foreground transition-colors mt-1">
                +{SCHEDULED_CARDS.length - 5} more
              </button>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {previewArtifact && <MockArtifactPreview artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
      {showCreateSchedule && <HomeCreateScheduleModal onClose={() => setShowCreateSchedule(false)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Populated Home
   ═══════════════════════════════════════════════════════════════════════════ */
function PopulatedHome({
  approvals,
  state,
}: {
  approvals: ApprovalView[];
  state: Exclude<DemoState, "empty">;
}) {
  const { setState } = useDemoState();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const visibleApprovals = useMemo(
    () => approvals.filter((a) => !dismissedIds.has(a.id)),
    [approvals, dismissedIds],
  );

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      const remaining = approvals.filter((a) => !next.has(a.id));
      if (remaining.length === 0) {
        setTimeout(() => setState("just-cleared"), 300);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Active blockers: blocked section at top */}
      {state === "active-blockers" && visibleApprovals.length > 0 && (
        <BlockedSectionFiltered
          approvals={visibleApprovals}
          onDismiss={handleDismiss}
        />
      )}

      {/* Compute */}
      <ComputePreview />

      {/* Cards in containers — stacked */}
      <div className="space-y-6">
        <ReadySection />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <RunningSection />
          <ScheduledSection />
        </div>

        {/* Benign blocked section — below running/ready when no active blockers */}
        {state === "just-cleared" && (
          <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[16px] font-semibold text-foreground">
                Needs attention
              </h2>
              <button
                type="button"
                className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
              >
                View history
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Checkmark size={16} className="text-success shrink-0" />
              <span className="text-[14px] text-muted-foreground">
                All clear · {MOCK_DECISIONS.length} decisions today
              </span>
            </div>
          </section>
        )}

        {state === "no-blockers" && (
          <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[16px] font-semibold text-foreground">
                Needs attention
              </h2>
              <button
                type="button"
                className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
              >
                View history
              </button>
            </div>
            <p className="text-[14px] text-muted-foreground">
              No approvals pending
            </p>
          </section>
        )}
      </div>

      {/* Spend — bottom of page, links to usage settings */}
      <SpendFooter />
    </div>
  );
}

function SpendFooter() {
  const navigateToSettings = useStore((s) => s.navigateToSettings);

  return (
    <button
      type="button"
      onClick={() => navigateToSettings("usage")}
      className="text-[14px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    >
      Spend this month: <span className="tabular-nums">$31.57</span>
    </button>
  );
}

const MOCK_DECISIONS = [
  {
    id: "d1",
    agent: "brand-asset-generator",
    request: "GET api.figma.com",
    type: "network" as const,
    action: "allowed",
    when: "12m ago",
  },
  {
    id: "d2",
    agent: "frontend-agent",
    request: "bash_execute",
    type: "tool" as const,
    action: "allowed permanently",
    when: "1h ago",
  },
  {
    id: "d3",
    agent: "photo-retouching",
    request: "POST storage.googleapis.com",
    type: "network" as const,
    action: "denied",
    when: "2h ago",
  },
  {
    id: "d4",
    agent: "brand-asset-generator",
    request: "GET fonts.google.com",
    type: "network" as const,
    action: "allowed all of fonts.google.com",
    when: "3h ago",
  },
  {
    id: "d5",
    agent: "color-palette-testing",
    request: "file_write",
    type: "tool" as const,
    action: "denied permanently",
    when: "5h ago",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Empty State
   ═══════════════════════════════════════════════════════════════════════════ */

function EmptyState() {
  return (
    <div className="space-y-6">
      <HomeHeader />

      {/* Welcome content — same as welcome modal */}
      <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-8">
        <h2 className="text-[20px] font-semibold text-foreground">
          Accelerate research with DAM
        </h2>
        <p className="mt-1.5 max-w-[560px] text-[14px] leading-relaxed text-muted-foreground">
          Run agents in isolated cloud environments with credentials and tools
          securely injected. Create knowledge bases, run experiments to compare
          agent variants, and trigger agents from Slack or on a schedule.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <a
            href={import.meta.env.VITE_PROTOTYPE ? "#/agent-setup" : "/agent-setup"}
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
          >
            <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
              <ContainerSoftware size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-foreground">
                Create a coding agent
              </p>
              <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                Work with your preferred coding agent, credentials, and tools in
                an isolated environment.
              </p>
            </div>
          </a>
          <a
            href={import.meta.env.VITE_PROTOTYPE ? "#/experiment-onboard" : "/experiment-onboard"}
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
          >
            <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
              <Chemistry size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-foreground">
                Begin an experiment
              </p>
              <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                Run one goal across many variants at once and compare results.
              </p>
            </div>
          </a>
          <a
            href={import.meta.env.VITE_PROTOTYPE ? "#/kb-setup" : "/kb-setup"}
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
          >
            <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
              <Book size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-foreground">
                Start a knowledge base
              </p>
              <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                Organize and converse with data sourced from repos, documents,
                and more (LLM wiki).
              </p>
            </div>
          </a>
        </div>

        <div className="mt-5 flex justify-end">
          <a
            href="https://docs.example.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[14px] font-medium text-accent no-underline hover:underline"
          >
            Or check out the Documentation →
          </a>
        </div>
      </section>

      {/* Compute — zeroed out */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
        <p className="text-[14px] text-muted-foreground mb-1">
          Compute resources
        </p>
        <p className="text-[28px] font-bold tabular-nums text-foreground leading-none tracking-tight mb-5">
          0/8 CPU
        </p>
        <div className="flex gap-0.5 mb-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-3 flex-1 rounded-full border border-muted-foreground/25 bg-background first:rounded-l-full last:rounded-r-full"
            />
          ))}
        </div>
        <p className="text-[14px] text-muted-foreground">
          8 CPU · 8 Gi available
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Bento 2 — Production-aligned typography
   Same layout/features as Bento 1, with corrected type scale:
   - Card titles: 15px (matching prod schedule-card)
   - Stat number: font-semibold tracking-[-0.65px] (matching page title style)
   - Body/metadata: 14px minimum throughout
   ═══════════════════════════════════════════════════════════════════════════ */
function BentoHomeLayout2({ demoState }: { demoState: DemoState }) {
  const [previewArtifact, setPreviewArtifact] = useState<ReviewSession["artifact"] | null>(null);
  const [dismissedReview, setDismissedReview] = useState<Set<number>>(new Set());
  const [feedFilter, setFeedFilter] = useState<FeedCategory[]>([...FEED_CATEGORIES]);
  const [dismissingReview, setDismissingReview] = useState<Set<number>>(new Set());
  const [collapsingReview, setCollapsingReview] = useState<Set<number>>(new Set());
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);

  const dismissReview = useCallback((idx: number) => {
    setDismissingReview(prev => new Set([...prev, idx]));
    setTimeout(() => {
      setCollapsingReview(prev => new Set([...prev, idx]));
    }, 200);
    setTimeout(() => {
      setDismissedReview(prev => new Set([...prev, idx]));
      setDismissingReview(prev => { const next = new Set(prev); next.delete(idx); return next; });
      setCollapsingReview(prev => { const next = new Set(prev); next.delete(idx); return next; });
    }, 500);
  }, []);

  const toggleFeedFilter = useCallback((cat: FeedCategory) => {
    setFeedFilter(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  }, []);

  const isEmptyState = demoState === "empty";
  const isClearedState = demoState === "just-cleared" || demoState === "no-blockers";
  const visibleReview = (isEmptyState || isClearedState) ? [] : REVIEW_SESSIONS.filter((item, i) => !dismissedReview.has(i) && feedFilter.includes(feedCategory(item)));
  const visibleActive = (isEmptyState || isClearedState) ? [] : ACTIVE_SESSIONS.filter(item => feedFilter.includes(feedCategoryActive(item)));
  const allCleared = isClearedState || (!isEmptyState && visibleActive.length === 0 && visibleReview.length === 0);

  const dismissAll = () => {
    const reviewIdxs = REVIEW_SESSIONS.map((_, i) => i).filter(i => !dismissedReview.has(i));
    setDismissingReview(new Set(reviewIdxs));
    setTimeout(() => {
      setCollapsingReview(new Set(reviewIdxs));
    }, 200);
    setTimeout(() => {
      setDismissedReview(new Set(REVIEW_SESSIONS.map((_, i) => i)));
      setDismissingReview(new Set());
      setCollapsingReview(new Set());
    }, 500);
  };

  return (
    <div className="space-y-4">

      {isEmptyState && (
        <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-8">
          <h2 className="text-[20px] font-semibold text-foreground">
            Accelerate research with DAM
          </h2>
          <p className="mt-1.5 max-w-[560px] text-[14px] leading-relaxed text-muted-foreground">
            Run agents in isolated cloud environments with credentials and tools
            securely injected. Create knowledge bases, run experiments to compare
            agent variants, and trigger agents from Slack or on a schedule.
          </p>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <a
              href={import.meta.env.VITE_PROTOTYPE ? "#/agent-setup" : "/agent-setup"}
              className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
                <ContainerSoftware size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">Create a coding agent</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                  Work with your preferred coding agent, credentials, and tools in an isolated environment.
                </p>
              </div>
            </a>
            <a
              href={import.meta.env.VITE_PROTOTYPE ? "#/experiment-onboard" : "/experiment-onboard"}
              className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
                <Chemistry size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">Begin an experiment</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                  Run one goal across many variants at once and compare results.
                </p>
              </div>
            </a>
            <a
              href={import.meta.env.VITE_PROTOTYPE ? "#/kb-setup" : "/kb-setup"}
              className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
                <Book size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">Start a knowledge base</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                  Organize and converse with data sourced from repos, documents, and more (LLM wiki).
                </p>
              </div>
            </a>
          </div>
          <div className="mt-5 flex justify-end">
            <a
              href="https://docs.example.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] font-medium text-accent no-underline hover:underline"
            >
              Or check out the Documentation →
            </a>
          </div>
        </section>
      )}

      {!isEmptyState && (
      <>
      {(visibleActive.length > 0 || visibleReview.length > 0) && (
        <div className="flex items-center justify-between" style={{ maxWidth: "calc(100% - 320px - 16px)" }}>
          <h1 className="text-[24px] font-semibold tracking-[-0.65px] text-foreground md:text-[28px]">Home</h1>
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="xs" className="text-[14px]">
                  <Filter size={16} />
                  {feedFilter.length === FEED_CATEGORIES.length
                    ? "All"
                    : `Filter (${feedFilter.length})`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {FEED_CATEGORIES.map((cat) => (
                  <DropdownMenuCheckboxItem
                    key={cat}
                    checked={feedFilter.includes(cat)}
                    onCheckedChange={() => toggleFeedFilter(cat)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {FEED_CATEGORY_LABELS[cat]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" className="h-8 text-[14px] text-muted-foreground" onClick={dismissAll}>
              Dismiss all
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
        {/* LEFT: Main feed */}
        <div className="space-y-4">
          {allCleared && (
            <div className="rounded-xl border border-border bg-card p-10 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Checkmark size={16} className="text-emerald-500" />
                <span className="text-[14px] font-medium text-foreground">All clear</span>
              </div>
              <p className="text-[14px] text-muted-foreground">Nothing waiting for review. You're all caught up.</p>
            </div>
          )}

          {/* Active sessions — in progress */}
          {visibleActive.map((item) => {
            const activeIdx = ACTIVE_SESSIONS.indexOf(item);
            return (
            <div key={`active-${activeIdx}`} className="rounded-xl border border-border bg-gradient-to-br from-blue-500/10 to-card p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                    {item.experiment ? <Chemistry size={16} className="shrink-0" /> : <Code size={16} className="shrink-0" />}
                    <span>{item.agent}</span>
                  </div>
                  <p className="text-[15px] font-semibold text-foreground leading-snug">
                    {item.title}
                    <WorkingDots className="text-blue-500 inline-flex align-middle ml-1" size="md" />
                  </p>
                </div>
                <span className="text-[14px] text-muted-foreground whitespace-nowrap shrink-0">{item.duration}</span>
              </div>
              {item.experiment && (
                <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border">
                  <span className="text-[14px] text-muted-foreground tabular-nums">{item.experiment.runs} runs</span>
                  <span className="text-[14px] text-muted-foreground/40">·</span>
                  <span className="text-[14px] text-blue-500 tabular-nums">{item.experiment.variants} live</span>
                </div>
              )}
              <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
                <Button size="sm" variant="outline" className="h-8 text-[14px]">Go to session</Button>
              </div>
            </div>
            );
          })}

          {/* Review sessions */}
          {visibleReview.map((item) => {
            const originalIdx = REVIEW_SESSIONS.indexOf(item);
            return (
            <div key={originalIdx} className={cn(
              "rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3 transition-all duration-300 ease-out",
              dismissingReview.has(originalIdx) && "opacity-0 scale-[0.98]",
              collapsingReview.has(originalIdx) && "!mt-0 !p-0 !border-0 max-h-0 overflow-hidden"
            )}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                    {item.scheduled ? <Time size={16} className="shrink-0" /> : item.experiment ? <Chemistry size={16} className="shrink-0" /> : <Code size={16} className="shrink-0" />}
                    <span>{item.agent}</span>
                  </div>
                  <p className="text-[15px] font-semibold text-foreground leading-snug">
                    {item.title}
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-500 align-middle ml-1.5" />
                  </p>
                </div>
                <span className="text-[14px] text-muted-foreground whitespace-nowrap shrink-0">{item.time}</span>
              </div>
              {item.experiment && (
                <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border">
                  <span className="text-[14px] text-muted-foreground tabular-nums">{item.experiment.runs} runs</span>
                  <span className="text-[14px] text-muted-foreground/40">·</span>
                  <span className="text-[14px] text-muted-foreground">ran {item.experiment.best}</span>
                </div>
              )}
              {item.artifact && (
                <button
                  type="button"
                  onClick={() => setPreviewArtifact(item.artifact!)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 hover:border-foreground/20 transition-all text-[14px] text-muted-foreground hover:text-foreground"
                >
                  <Document size={16} className="shrink-0" />
                  <span className="truncate max-w-[160px]">{item.artifact.name}</span>
                </button>
              )}
              <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
                <Button size="sm" variant="outline" className="h-8 text-[14px]">Go to session</Button>
                <Button size="sm" variant="ghost" className="h-8 text-[14px] text-muted-foreground ml-auto" onClick={() => dismissReview(originalIdx)}>Dismiss</Button>
              </div>
            </div>
            );
          })}
        </div>

        {/* RIGHT: Pinned sidebar */}
        <div className="space-y-3 sticky top-4">
          {/* Needs attention */}
          <div className="rounded-xl border border-destructive/30 bg-gradient-to-br from-destructive/5 to-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-destructive" />
              <h2 className="text-[14px] text-muted-foreground">Needs attention</h2>
            </div>
            <p className="text-[15px] text-foreground font-medium">GET api.figma.com</p>
            <p className="text-[14px] text-muted-foreground">brand-asset-generator · 3m ago</p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="h-7 text-[14px] flex-1">Allow</Button>
              <Button size="sm" variant="ghost" className="h-7 text-[14px] flex-1 text-muted-foreground">Deny</Button>
            </div>
          </div>

          {/* Compute resources */}
          <ComputePreview />

          {/* Scheduled */}
          <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[14px] text-muted-foreground">Scheduled</p>
              <Button variant="outline" size="xs" className="text-[14px]" onClick={() => setShowCreateSchedule(true)}>
                <Add size={16} /> New
              </Button>
            </div>
            <div className="space-y-2.5">
              {SCHEDULED_CARDS.slice(0, 5).map((s, i) => {
                const failed = s.lastResult === "failed";
                return (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-[14px] text-foreground truncate">{s.name}</span>
                    <span className={cn(
                      "text-[14px] tabular-nums shrink-0",
                      failed ? "text-destructive" : "text-muted-foreground",
                    )}>{s.nextRun}</span>
                  </div>
                );
              })}
              <button type="button" className="text-[14px] text-muted-foreground hover:text-foreground transition-colors mt-1">
                +{SCHEDULED_CARDS.length - 5} more
              </button>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {previewArtifact && <MockArtifactPreview artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
      {showCreateSchedule && <HomeCreateScheduleModal onClose={() => setShowCreateSchedule(false)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Bento Home Layout 3 — Refined
   Title-first hierarchy. Titles are 16px semibold (primary scan target).
   Metadata subordinate below at 14px muted. No card borders on feed items —
   active items get faint blue tint, reviews are borderless rows. Sidebar is
   a flat panel with section headers.
   ═══════════════════════════════════════════════════════════════════════════ */

function BentoHomeLayout3({ demoState }: { demoState: DemoState }) {
  const [previewArtifact, setPreviewArtifact] = useState<ReviewSession["artifact"] | null>(null);
  const [dismissedReview, setDismissedReview] = useState<Set<number>>(new Set());
  const [feedFilter, setFeedFilter] = useState<FeedCategory[]>([...FEED_CATEGORIES]);
  const [dismissingReview, setDismissingReview] = useState<Set<number>>(new Set());
  const [collapsingReview, setCollapsingReview] = useState<Set<number>>(new Set());
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);

  const dismissReview = useCallback((idx: number) => {
    setDismissingReview(prev => new Set([...prev, idx]));
    setTimeout(() => { setCollapsingReview(prev => new Set([...prev, idx])); }, 200);
    setTimeout(() => {
      setDismissedReview(prev => new Set([...prev, idx]));
      setDismissingReview(prev => { const next = new Set(prev); next.delete(idx); return next; });
      setCollapsingReview(prev => { const next = new Set(prev); next.delete(idx); return next; });
    }, 500);
  }, []);

  const toggleFeedFilter = useCallback((cat: FeedCategory) => {
    setFeedFilter(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  }, []);

  const isEmptyState = demoState === "empty";
  const isClearedState = demoState === "just-cleared" || demoState === "no-blockers";
  const visibleReview = (isEmptyState || isClearedState) ? [] : REVIEW_SESSIONS.filter((item, i) => !dismissedReview.has(i) && feedFilter.includes(feedCategory(item)));
  const visibleActive = (isEmptyState || isClearedState) ? [] : ACTIVE_SESSIONS.filter(item => feedFilter.includes(feedCategoryActive(item)));
  const allCleared = isClearedState || (!isEmptyState && visibleActive.length === 0 && visibleReview.length === 0);

  const dismissAll = () => {
    const reviewIdxs = REVIEW_SESSIONS.map((_, i) => i).filter(i => !dismissedReview.has(i));
    setDismissingReview(new Set(reviewIdxs));
    setTimeout(() => { setCollapsingReview(new Set(reviewIdxs)); }, 200);
    setTimeout(() => {
      setDismissedReview(new Set(REVIEW_SESSIONS.map((_, i) => i)));
      setDismissingReview(new Set());
      setCollapsingReview(new Set());
    }, 500);
  };

  return (
    <div className="space-y-8">

      {isEmptyState && (
        <section className="pt-8">
          <h2 className="text-[20px] font-semibold text-foreground tracking-[-0.3px]">
            Accelerate research with DAM
          </h2>
          <p className="mt-2 max-w-[480px] text-[14px] leading-relaxed text-muted-foreground">
            Run agents in isolated cloud environments with credentials and tools
            securely injected. Create knowledge bases, run experiments, and
            trigger agents from Slack or on a schedule.
          </p>
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-px bg-border/50 rounded-2xl overflow-hidden">
            <a href={import.meta.env.VITE_PROTOTYPE ? "#/agent-setup" : "/agent-setup"} className="group flex flex-col gap-4 bg-background p-7 no-underline transition-colors hover:bg-muted/30">
              <ContainerSoftware size={16} className="text-muted-foreground" />
              <div>
                <p className="text-[15px] font-semibold text-foreground">Coding agent</p>
                <p className="mt-1 text-[14px] leading-snug text-muted-foreground">Work with your preferred agent, credentials, and tools in isolation.</p>
              </div>
            </a>
            <a href={import.meta.env.VITE_PROTOTYPE ? "#/experiment-onboard" : "/experiment-onboard"} className="group flex flex-col gap-4 bg-background p-7 no-underline transition-colors hover:bg-muted/30">
              <Chemistry size={16} className="text-muted-foreground" />
              <div>
                <p className="text-[15px] font-semibold text-foreground">Experiment</p>
                <p className="mt-1 text-[14px] leading-snug text-muted-foreground">Run one goal across many variants at once and compare results.</p>
              </div>
            </a>
            <a href={import.meta.env.VITE_PROTOTYPE ? "#/kb-setup" : "/kb-setup"} className="group flex flex-col gap-4 bg-background p-7 no-underline transition-colors hover:bg-muted/30">
              <Book size={16} className="text-muted-foreground" />
              <div>
                <p className="text-[15px] font-semibold text-foreground">Knowledge base</p>
                <p className="mt-1 text-[14px] leading-snug text-muted-foreground">Organize and converse with data sourced from repos and documents.</p>
              </div>
            </a>
          </div>
          <p className="mt-6 text-[14px] text-muted-foreground">
            <a href="https://docs.example.com" target="_blank" rel="noopener noreferrer" className="text-foreground no-underline hover:underline">Read the docs</a>
            {" "}to learn more.
          </p>
        </section>
      )}

      {!isEmptyState && (
      <>
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[18px] font-semibold tracking-[-0.3px] text-foreground">Activity</h1>
          {(visibleActive.length > 0 || visibleReview.length > 0) && (
            <span className="text-[14px] text-muted-foreground tabular-nums">{visibleActive.length + visibleReview.length}</span>
          )}
        </div>
        {(visibleActive.length > 0 || visibleReview.length > 0) && (
          <div className="flex items-center gap-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-1.5 text-[14px] text-muted-foreground hover:text-foreground transition-colors">
                  <Filter size={16} />
                  {feedFilter.length === FEED_CATEGORIES.length ? "All" : `${feedFilter.length}`}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {FEED_CATEGORIES.map((cat) => (
                  <DropdownMenuCheckboxItem key={cat} checked={feedFilter.includes(cat)} onCheckedChange={() => toggleFeedFilter(cat)} onSelect={(e) => e.preventDefault()}>
                    {FEED_CATEGORY_LABELS[cat]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" className="text-[14px] text-muted-foreground hover:text-foreground transition-colors" onClick={dismissAll}>Clear all</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
        {/* LEFT: Main feed */}
        <div className="space-y-3">
          {/* Needs attention — in main feed */}
          <div className="rounded-2xl border border-border bg-card/80 p-5 transition-colors">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  <span>Needs attention</span>
                </div>
                <p className="text-[15px] text-foreground">
                  brand-asset-generator
                  <span className="text-muted-foreground font-normal text-[14px] ml-2">
                    wants to access
                  </span>
                </p>
                <p className="font-mono text-[14px] text-muted-foreground mt-0.5 truncate">
                  GET api.figma.com
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm">Allow</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="px-2">
                      <OverflowMenuVertical size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Allow permanently</DropdownMenuItem>
                    <DropdownMenuItem>Allow all of api.figma.com</DropdownMenuItem>
                    <DropdownMenuItem>Deny this request</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive">Deny permanently</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>

          {allCleared && (
            <div className="py-20 text-center">
              <Checkmark size={16} className="text-emerald-500 mx-auto mb-2" />
              <p className="text-[16px] font-semibold text-foreground">All clear</p>
              <p className="mt-1 text-[14px] text-muted-foreground">Nothing needs your attention right now.</p>
            </div>
          )}

          {/* Active sessions — in progress */}
          {visibleActive.map((item) => {
            const activeIdx = ACTIVE_SESSIONS.indexOf(item);
            return (
            <div key={`active-${activeIdx}`} className="rounded-2xl border border-blue-500/10 bg-blue-500/[0.03] p-5">
              <div className="flex items-start gap-3">
                <div className="pt-[3px] text-blue-500">
                  {item.experiment ? <Chemistry size={16} className="shrink-0" /> : <Code size={16} className="shrink-0" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-semibold text-foreground leading-snug">
                    {item.title}
                    <WorkingDots className="text-blue-500 inline-flex align-middle ml-1.5" size="md" />
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5 text-[14px] text-muted-foreground">
                    <span>{item.agent}</span>
                    <span className="text-border">·</span>
                    <span>{item.duration}</span>
                    {item.experiment && (
                      <>
                        <span className="text-border">·</span>
                        <span className="tabular-nums">{item.experiment.runs} runs</span>
                        <span className="text-border">·</span>
                        <span className="text-blue-500 tabular-nums">{item.experiment.variants} live</span>
                      </>
                    )}
                  </div>
                  <button type="button" className="mt-3 text-[14px] text-muted-foreground hover:text-foreground transition-colors">
                    View session →
                  </button>
                </div>
              </div>
            </div>
            );
          })}

          {/* Review sessions */}
          {visibleReview.map((item) => {
            const originalIdx = REVIEW_SESSIONS.indexOf(item);
            return (
            <div key={originalIdx} className={cn(
              "rounded-2xl border border-border/50 bg-card/80 p-5 transition-all duration-300 ease-out",
              dismissingReview.has(originalIdx) && "opacity-0 scale-[0.98]",
              collapsingReview.has(originalIdx) && "!mt-0 !p-0 !border-0 max-h-0 overflow-hidden"
            )}>
              <div className="flex items-start gap-3">
                <div className="pt-[3px] text-muted-foreground">
                  {item.scheduled ? <Time size={16} className="shrink-0" /> : item.experiment ? <Chemistry size={16} className="shrink-0" /> : <Code size={16} className="shrink-0" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-semibold text-foreground leading-snug">
                    {item.title}
                    <span className="inline-block w-[7px] h-[7px] rounded-full bg-blue-500 align-middle ml-2" />
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5 text-[14px] text-muted-foreground">
                    <span>{item.agent}</span>
                    <span className="text-border">·</span>
                    <span>{item.time}</span>
                    {item.experiment && (
                      <>
                        <span className="text-border">·</span>
                        <span className="tabular-nums">{item.experiment.runs} runs</span>
                        <span className="text-border">·</span>
                        <span>best: {item.experiment.best}</span>
                      </>
                    )}
                  </div>
                  {item.artifact && (
                    <button
                      type="button"
                      onClick={() => setPreviewArtifact(item.artifact!)}
                      className="mt-2 inline-flex items-center gap-1.5 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Document size={16} className="shrink-0" />
                      <span className="truncate max-w-[240px]">{item.artifact.name}</span>
                    </button>
                  )}
                  <div className="flex items-center gap-4 mt-3">
                    <button type="button" className="text-[14px] text-muted-foreground hover:text-foreground transition-colors">View session →</button>
                    <button type="button" className="text-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-colors" onClick={() => dismissReview(originalIdx)}>Dismiss</button>
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>

        {/* RIGHT: Sidebar — Compute + Schedules only */}
        <div className="sticky top-4 space-y-4">
          {/* Compute resources */}
          <ComputePreview />

          {/* Scheduled */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[14px] font-semibold text-foreground">Scheduled</span>
              <Button variant="outline" size="xs" className="text-[14px]" onClick={() => setShowCreateSchedule(true)}>
                <Add size={16} /> New
              </Button>
            </div>
            <div className="space-y-2.5">
              {SCHEDULED_CARDS.slice(0, 5).map((s, i) => {
                const failed = s.lastResult === "failed";
                return (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <span className="text-[14px] text-foreground truncate">{s.name}</span>
                    <span className={cn(
                      "text-[14px] tabular-nums shrink-0",
                      failed ? "text-destructive" : "text-muted-foreground",
                    )}>{s.nextRun}</span>
                  </div>
                );
              })}
              <button type="button" className="text-[14px] text-muted-foreground hover:text-foreground transition-colors">
                +{SCHEDULED_CARDS.length - 5} more
              </button>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {previewArtifact && <MockArtifactPreview artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
      {showCreateSchedule && <HomeCreateScheduleModal onClose={() => setShowCreateSchedule(false)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Feed Dashboard Layout
   Centered single-column feed using real project content.
   "Good morning" + "Activity" header, category pill filters.
   Cards use BentoHomeLayout2's internal structure with Feed color palette.
   ═══════════════════════════════════════════════════════════════════════════ */

const FEED_TABS = ["all", "attention", "agents", "experiments", "knowledge", "schedules"] as const;
type FeedTab = (typeof FEED_TABS)[number];
const FEED_TAB_LABELS: Record<FeedTab, string> = {
  all: "All",
  attention: "Needs attention",
  agents: "Coding agents",
  experiments: "Experiments",
  knowledge: "Knowledge bases",
  schedules: "Schedules",
};

function FeedFilterDropdown({ value, onChange }: { value: FeedTab; onChange: (v: FeedTab) => void }) {
  const label = FEED_TAB_LABELS[value];
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {label}
        <ChevronDown
          size={16}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-md py-1 min-w-[140px]">
            {FEED_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => { onChange(tab); setOpen(false); }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-[14px] transition-colors",
                  value === tab
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {FEED_TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type FeedStatus = "everything" | "in-progress" | "unread" | "read" | "attention";
type FeedTime = "all" | "24h" | "7d" | "30d";

const FEED_STATUS_LABELS: Record<FeedStatus, string> = {
  everything: "Everything",
  "in-progress": "In progress",
  unread: "Unread",
  read: "Read",
  attention: "Needs attention",
};

const FEED_TIME_LABELS: Record<FeedTime, string> = {
  all: "All time",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

function FeedFilterBar({
  status,
  onStatusChange,
  time,
  onTimeChange,
}: {
  status: FeedStatus;
  onStatusChange: (v: FeedStatus) => void;
  time: FeedTime;
  onTimeChange: (v: FeedTime) => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

  return (
    <div className="flex items-center gap-3">
      {/* Status dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => { setStatusOpen(!statusOpen); setTimeOpen(false); }}
          className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {FEED_STATUS_LABELS[status]}
          <ChevronDown size={16} className={cn("transition-transform", statusOpen && "rotate-180")} />
        </button>
        {statusOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setStatusOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-md py-1 min-w-[160px]">
              {(Object.keys(FEED_STATUS_LABELS) as FeedStatus[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { onStatusChange(key); setStatusOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-[14px] transition-colors",
                    status === key
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  {FEED_STATUS_LABELS[key]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Time dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => { setTimeOpen(!timeOpen); setStatusOpen(false); }}
          className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {FEED_TIME_LABELS[time]}
          <ChevronDown size={16} className={cn("transition-transform", timeOpen && "rotate-180")} />
        </button>
        {timeOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setTimeOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-md py-1 min-w-[160px]">
              {(Object.keys(FEED_TIME_LABELS) as FeedTime[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { onTimeChange(key); setTimeOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-[14px] transition-colors",
                    time === key
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  {FEED_TIME_LABELS[key]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FeedDashboardLayout() {
  const { state: demoState } = useDemoState();
  const [previewArtifact, setPreviewArtifact] = useState<ReviewSession["artifact"] | null>(null);
  const [dismissedReview, setDismissedReview] = useState<Set<number>>(new Set());
  const [_activeTab, _setActiveTab] = useState<FeedTab>("all");
  const [statusFilter, setStatusFilter] = useState<FeedStatus>("everything");
  const [timeFilter, setTimeFilter] = useState<FeedTime>("all");
  const [dismissingReview, setDismissingReview] = useState<Set<number>>(new Set());
  const [collapsingReview, setCollapsingReview] = useState<Set<number>>(new Set());
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);

  const [dismissedActive, setDismissedActive] = useState<Set<number>>(new Set());
  const [attentionDismissed, setAttentionDismissed] = useState(false);

  const dismissReview = useCallback((idx: number) => {
    setDismissingReview(prev => new Set([...prev, idx]));
    setTimeout(() => { setCollapsingReview(prev => new Set([...prev, idx])); }, 200);
    setTimeout(() => {
      setDismissedReview(prev => new Set([...prev, idx]));
      setDismissingReview(prev => { const next = new Set(prev); next.delete(idx); return next; });
      setCollapsingReview(prev => { const next = new Set(prev); next.delete(idx); return next; });
    }, 500);
  }, []);

  const isEmptyState = demoState === "empty";
  const isClearedState = demoState === "just-cleared" || demoState === "no-blockers";

  const showAttention = (statusFilter === "everything" || statusFilter === "attention") && !attentionDismissed;

  const visibleReview = (isEmptyState || isClearedState) ? [] : REVIEW_SESSIONS.filter((_item, i) => {
    if (dismissedReview.has(i)) return false;
    if (statusFilter === "everything") return true;
    if (statusFilter === "unread") return true;
    if (statusFilter === "read") return false;
    return false;
  });
  const visibleActive = (isEmptyState || isClearedState) ? [] : ACTIVE_SESSIONS.filter((_item, i) => {
    if (dismissedActive.has(i)) return false;
    if (statusFilter === "in-progress" || statusFilter === "everything") return true;
    return false;
  });
  const allCleared = isClearedState || (!isEmptyState && visibleActive.length === 0 && visibleReview.length === 0 && !showAttention);

  const dismissAll = () => {
    const reviewIdxs = REVIEW_SESSIONS.map((_, i) => i).filter(i => !dismissedReview.has(i));
    setDismissingReview(new Set(reviewIdxs));
    setTimeout(() => { setCollapsingReview(new Set(reviewIdxs)); }, 200);
    setTimeout(() => {
      setDismissedReview(new Set(REVIEW_SESSIONS.map((_, i) => i)));
      setDismissedActive(new Set(ACTIVE_SESSIONS.map((_, i) => i)));
      setAttentionDismissed(true);
      setDismissingReview(new Set());
      setCollapsingReview(new Set());
    }, 500);
  };

  return (
    <div className="space-y-6">

      {/* Empty state — matches the Current home page EmptyState exactly */}
      {isEmptyState && (
        <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-8">
          <h2 className="text-[20px] font-semibold text-foreground">
            Accelerate research with DAM
          </h2>
          <p className="mt-1.5 max-w-[560px] text-[14px] leading-relaxed text-muted-foreground">
            Run agents in isolated cloud environments with credentials and tools
            securely injected. Create knowledge bases, run experiments to compare
            agent variants, and trigger agents from Slack or on a schedule.
          </p>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <a
              href={import.meta.env.VITE_PROTOTYPE ? "#/agent-setup" : "/agent-setup"}
              className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
                <ContainerSoftware size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">Create a coding agent</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                  Work with your preferred coding agent, credentials, and tools in an isolated environment.
                </p>
              </div>
            </a>
            <a
              href={import.meta.env.VITE_PROTOTYPE ? "#/experiment-onboard" : "/experiment-onboard"}
              className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
                <Chemistry size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">Begin an experiment</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                  Run one goal across many variants at once and compare results.
                </p>
              </div>
            </a>
            <a
              href={import.meta.env.VITE_PROTOTYPE ? "#/kb-setup" : "/kb-setup"}
              className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
                <Book size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-foreground">Start a knowledge base</p>
                <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
                  Organize and converse with data sourced from repos, documents, and more (LLM wiki).
                </p>
              </div>
            </a>
          </div>
          <div className="mt-5 flex justify-end">
            <a
              href="https://docs.example.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[14px] font-medium text-accent no-underline hover:underline"
            >
              Or check out the Documentation →
            </a>
          </div>
        </section>
      )}

      {!isEmptyState && (
      <>
        {/* Greeting — own line */}
        <div className="pb-4">
          <p className="text-[18px] text-muted-foreground mb-1">Good morning</p>
          <h1 className="text-[40px] font-bold tracking-[-1px] text-foreground leading-none">Activity</h1>
        </div>

        <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
          {/* LEFT: Feed */}
          <div className="space-y-3">
            {/* Filter + stats — scoped to feed column only */}
            <div className="flex items-center justify-between pb-3">
              <FeedFilterBar status={statusFilter} onStatusChange={setStatusFilter} time={timeFilter} onTimeChange={setTimeFilter} />
              {(visibleActive.length > 0 || visibleReview.length > 0) && (
                <div className="flex items-center gap-4">
                  <p className="text-[14px] text-muted-foreground tabular-nums">
                    <span className="text-foreground font-medium">{visibleActive.length}</span> running
                    <span className="text-border mx-1.5">·</span>
                    <span className="text-foreground font-medium">{visibleReview.length}</span> to review
                  </p>
                  <button type="button" className="text-[14px] text-muted-foreground hover:text-foreground transition-colors" onClick={dismissAll}>
                    Clear all
                  </button>
                </div>
              )}
            </div>
            {/* Needs attention — approval card matching ApprovalVariant1 */}
            {showAttention && (
              <div className="rounded-2xl border border-border bg-card/80 p-5 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                      <span>Needs attention</span>
                    </div>
                    <p className="text-[15px] text-foreground">
                      brand-asset-generator
                      <span className="text-muted-foreground font-normal text-[14px] ml-2">
                        wants to access
                      </span>
                    </p>
                    <p className="font-mono text-[14px] text-muted-foreground mt-0.5 truncate">
                      GET api.figma.com
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm">Allow</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="px-2">
                          <OverflowMenuVertical size={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>Allow permanently</DropdownMenuItem>
                        <DropdownMenuItem>Allow all of api.figma.com</DropdownMenuItem>
                        <DropdownMenuItem>Deny this request</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">Deny permanently</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            )}

            {allCleared && (
              <div className="rounded-xl border border-border bg-card/80 p-10 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Checkmark size={16} className="text-emerald-500" />
                  <span className="text-[14px] font-medium text-foreground">All clear</span>
                </div>
                <p className="text-[14px] text-muted-foreground">Nothing waiting for review. You're all caught up.</p>
              </div>
            )}

            {/* Active sessions — clickable card with hover arrow */}
            {visibleActive.map((item) => {
              const activeIdx = ACTIVE_SESSIONS.indexOf(item);
              return (
              <button
                key={`active-${activeIdx}`}
                type="button"
                className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200 hover:shadow-lg"
              >
                <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                  {item.scheduled ? <Time size={16} className="shrink-0" /> : item.experiment ? <Chemistry size={16} className="shrink-0" /> : <Code size={16} className="shrink-0" />}
                  <span>{item.agent}</span>
                </div>
                <p className="text-[15px] font-semibold text-foreground leading-snug">
                  {item.title}
                  <WorkingDots className="text-blue-500 inline-flex align-middle ml-1" size="md" />
                </p>
                {item.experiment && (
                  <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
                    <span className="text-[14px] text-muted-foreground tabular-nums">{item.experiment.runs} runs</span>
                    <span className="text-[14px] text-muted-foreground/40">·</span>
                    <span className="text-[14px] text-blue-500 tabular-nums">{item.experiment.variants} live</span>
                  </div>
                )}
                <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] text-muted-foreground">{item.duration}</span>
                    {item.scheduled && (
                      <span className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-all cursor-pointer" onClick={(e) => e.stopPropagation()}>
                        · Edit schedule
                      </span>
                    )}
                  </div>
                  <span className="w-[24px] text-center text-muted-foreground/20 transition-all duration-200 group-hover:text-foreground group-hover:translate-x-0.5">→</span>
                </div>
              </button>
              );
            })}

            {/* Review sessions — clickable card with hover arrow + dismiss top-right */}
            {visibleReview.map((item) => {
              const originalIdx = REVIEW_SESSIONS.indexOf(item);
              return (
              <div
                key={originalIdx}
                className={cn(
                  "group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-300 ease-out cursor-pointer hover:shadow-lg",
                  dismissingReview.has(originalIdx) && "opacity-0 scale-[0.98]",
                  collapsingReview.has(originalIdx) && "!mt-0 !p-0 !border-0 max-h-0 overflow-hidden"
                )}
                onClick={() => {/* navigate to session */}}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                      {item.scheduled ? <Time size={16} className="shrink-0" /> : item.experiment ? <Chemistry size={16} className="shrink-0" /> : <Code size={16} className="shrink-0" />}
                      <span>{item.agent}</span>
                    </div>
                    <p className="text-[15px] font-semibold text-foreground leading-snug">
                      {item.title}
                      <span className="inline-block w-2 h-2 rounded-full bg-blue-500 align-middle ml-1.5" />
                    </p>
                  </div>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground hover:text-foreground transition-all shrink-0"
                    onClick={(e) => { e.stopPropagation(); dismissReview(originalIdx); }}
                  >
                    Dismiss
                  </button>
                </div>
                {item.experiment && (
                  <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
                    <span className="text-[14px] text-muted-foreground tabular-nums">{item.experiment.runs} runs</span>
                    <span className="text-[14px] text-muted-foreground/40">·</span>
                    <span className="text-[14px] text-muted-foreground">ran {item.experiment.best}</span>
                  </div>
                )}
                {item.artifact && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPreviewArtifact(item.artifact!); }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border/50 bg-muted/40 hover:bg-muted/70 hover:border-border transition-all text-[14px] text-muted-foreground hover:text-foreground mt-3"
                  >
                    <Document size={16} className="shrink-0" />
                    <span className="truncate max-w-[160px]">{item.artifact.name}</span>
                  </button>
                )}
                <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] text-muted-foreground">{item.time}</span>
                    {item.scheduled && (
                      <span className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-all cursor-pointer" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        · Edit schedule
                      </span>
                    )}
                  </div>
                  <span className="w-[24px] text-center text-muted-foreground/20 transition-all duration-200 group-hover:text-foreground group-hover:translate-x-0.5">→</span>
                </div>
              </div>
              );
            })}
          </div>

          {/* RIGHT: Sidebar — Compute + Schedules */}
          <div className="sticky top-4 space-y-4">
            <ComputePreview />

            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center justify-between mb-4 min-h-[32px]">
                <p className="text-[14px] text-muted-foreground">Scheduled</p>
                <Button variant="outline" size="xs" className="text-[14px]" onClick={() => setShowCreateSchedule(true)}>
                  <Add size={16} /> New
                </Button>
              </div>
              <div className="space-y-2.5">
                {SCHEDULED_CARDS.slice(0, 5).map((s, i) => {
                  const failed = s.lastResult === "failed";
                  return (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="text-[14px] text-foreground truncate">{s.name}</span>
                      <span className={cn(
                        "text-[14px] tabular-nums shrink-0",
                        failed ? "text-destructive" : "text-muted-foreground",
                      )}>{s.nextRun}</span>
                    </div>
                  );
                })}
                <button type="button" className="text-[14px] text-muted-foreground hover:text-foreground transition-colors">
                  +{SCHEDULED_CARDS.length - 5} more
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
      )}

      {previewArtifact && <MockArtifactPreview artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />}
      {showCreateSchedule && <HomeCreateScheduleModal onClose={() => setShowCreateSchedule(false)} />}
    </div>
  );
}
