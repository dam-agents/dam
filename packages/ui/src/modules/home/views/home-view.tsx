import { Book, Chemistry, ContainerSoftware } from "@carbon/icons-react";
import { Check, ChevronDown } from "lucide-react";
import { Children, type ReactNode, useEffect, useMemo, useState } from "react";

import { ListSkeleton } from "@/components/list-skeleton";
import { cn } from "@/lib/utils";

import { type DemoState, useDemoState } from "../../../mock/demo-state.js";
import { useStore } from "../../../store.js";
import { usePendingApprovals } from "../../approvals/api/queries.js";
import { HomeHeader } from "../components/home-header.js";
import { useAgentRows } from "../home-data.js";
import {
  type DigestRange,
  markVisitNow,
  useDigestRange,
} from "../home-digest-store.js";
import {
  ApprovalVariant1,
  ArtifactCard,
  ComputePreview,
  ExperimentCard,
  ScheduleCard,
  SessionFinishedCard,
  SessionRunningCard,
} from "./comparison-view.js";
/* ═══════════════════════════════════════════════════════════════════════════
   Home Page
   ═══════════════════════════════════════════════════════════════════════════ */

export function HomeView() {
  const { agentsData, initialLoaded } = useAgentRows();
  const agents = agentsData?.list ?? [];
  const { data: pendingApprovals } = usePendingApprovals();
  const approvals = useMemo(() => pendingApprovals ?? [], [pendingApprovals]);
  const { state: demoState } = useDemoState();
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

  if (import.meta.env.VITE_MOCK && demoState === "empty") {
    return <EmptyState />;
  }

  const populatedState = demoState === "empty" ? "active-blockers" : demoState;

  return (
    <div className="space-y-6">
      <HomeHeader />
      <PopulatedHome approvals={approvals} state={populatedState} />
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
          size={14}
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
            Blocked{" "}
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
  {
    type: "schedule",
    ageMinutes: 180,
    element: (
      <ScheduleCard
        name="Daily brand audit"
        cadence="Every weekday at 9:00 AM"
        nextRun="in 3h"
        lastResult="success"
        enabled={true}
      />
    ),
  },
];

export const READY_CARDS: MockCard[] = [
  {
    type: "session",
    ageMinutes: 45,
    element: (
      <SessionFinishedCard
        title="Refactor auth middleware"
        agentName="backend-refactor"
        updatedAt="45m ago"
        scheduled={false}
      />
    ),
  },
  {
    type: "artifact",
    ageMinutes: 120,
    element: (
      <ArtifactCard
        title="Spring campaign hero images"
        agentName="brand-asset-generator"
        updatedAt="2h ago"
      />
    ),
  },
  {
    type: "schedule",
    ageMinutes: 360,
    element: (
      <SessionFinishedCard
        title="Daily brand audit"
        agentName="brand-asset-generator"
        updatedAt="6h ago"
        scheduled={true}
      />
    ),
  },
  {
    type: "artifact",
    ageMinutes: 480,
    element: (
      <ArtifactCard
        title="Nightly performance report"
        agentName="reporting-agent"
        updatedAt="8h ago"
      />
    ),
  },
  {
    type: "experiment",
    ageMinutes: 600,
    element: (
      <ExperimentCard
        agentName="color-palette-testing"
        experimentName="Spring palette — warm vs cool tones"
        status="completed"
        runningInvocations={0}
        completedRuns={5}
      />
    ),
  },
  {
    type: "schedule",
    ageMinutes: 840,
    element: (
      <ScheduleCard
        name="Nightly test suite"
        cadence="Every day at 2:00 AM"
        nextRun="in 14h"
        lastResult="failed: agent exceeded timeout after 45m"
        enabled={true}
      />
    ),
  },
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
          size={14}
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

export const RANGE_MINUTES: Record<Exclude<DigestRange, "auto">, number> = {
  "1h": 60,
  "4h": 240,
  "12h": 720,
  "24h": 1440,
  "3d": 4320,
  "7d": 10080,
};

export function filterCards(
  cards: MockCard[],
  filter: CardType,
  range: DigestRange,
): ReactNode[] {
  const maxMinutes = range === "auto" ? Infinity : RANGE_MINUTES[range];
  let filtered = cards.filter((c) => c.ageMinutes <= maxMinutes);
  if (filter !== "all") {
    const typeMap: Record<CardType, string> = {
      all: "",
      sessions: "session",
      experiments: "experiment",
      schedules: "schedule",
      artifacts: "artifact",
    };
    filtered = filtered.filter((c) => c.type === typeMap[filter]);
  }
  return filtered.map((c) => c.element);
}

function RunningSection() {
  const [filter, setFilter] = useState<CardType>("all");
  const [range] = useDigestRange();
  const filtered = filterCards(RUNNING_CARDS, filter, range);

  return (
    <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[16px] font-semibold text-foreground">
          Running now{" "}
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
  const [range] = useDigestRange();
  const filtered = filterCards(READY_CARDS, filter, range);

  return (
    <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[16px] font-semibold text-foreground">
          Ready for you{" "}
          <span className="text-[14px] font-normal text-muted-foreground">
            ({filtered.length})
          </span>
        </h2>
        <CardTypeFilter value={filter} onChange={setFilter} />
      </div>
      {filtered.length > 0 ? (
        <StackedCards label="ready">
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
        <RunningSection />

        {/* Benign blocked section — below running/ready when no active blockers */}
        {state === "just-cleared" && (
          <section className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[16px] font-semibold text-foreground">
                Blocked
              </h2>
              <button
                type="button"
                className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
              >
                View history
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Check size={14} className="text-success shrink-0" />
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
                Blocked
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
              <ContainerSoftware size={24} />
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
            href={import.meta.env.VITE_PROTOTYPE ? "#/experiment-setup" : "/experiment-setup"}
            className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-all hover:shadow-lg"
          >
            <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/80">
              <Chemistry size={24} />
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
              <Book size={24} />
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
