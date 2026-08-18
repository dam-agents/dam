import {
  Book,
  Checkmark,
  Chemistry,
  ChevronDown,
  Close,
  Code,
  ContainerSoftware,
  OverflowMenuVertical,
  Settings,
  Time,
} from "@carbon/icons-react";
import type { ApprovalView, LibraryArtifact } from "api-server-api";
import {
  Children,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { FormField } from "@/components/form-field";
import { ListSkeleton } from "@/components/list-skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useDemoState } from "../../../mock/demo-state.js";
import { useStore } from "../../../store.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../../approvals/api/mutations.js";
import { usePendingApprovals } from "../../approvals/api/queries.js";
import { ArtifactPreviewDialog } from "../../artifacts/components/artifact-preview-dialog.js";
import { ScheduleFormModal } from "../../schedules/forms/schedule-form-modal.js";
import { HomeHeader } from "../components/home-header.js";
import { useAgentRows } from "../home-data.js";
import { markVisitNow } from "../home-digest-store.js";
import {
  ComputePreview,
  experimentPill,
  FeedActiveCard,
  FeedFinishedCard,
  ScheduleOverviewWidget,
  SpendPreview,
} from "./comparison-view.js";
/* ═══════════════════════════════════════════════════════════════════════════
   Home Page
   ═══════════════════════════════════════════════════════════════════════════ */

export function HomeView() {
  const { initialLoaded } = useAgentRows();
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

  return <FeedDashboardLayout />;
}

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
        <FeedApprovalCard
          key={row.id}
          row={row}
          onResolve={() => onDismiss?.(row.id)}
        />
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
      <FeedActiveCard
        icon={<Code size={16} className="shrink-0" />}
        agentName="frontend-agent"
        title="Implement dark mode toggle"
        duration="12m"
      />
    ),
  },
  {
    type: "experiment",
    ageMinutes: 45,
    element: (
      <FeedActiveCard
        icon={<Chemistry size={16} className="shrink-0" />}
        agentName="color-palette-testing"
        title="Spring palette — warm vs cool tones"
        duration="45m"
        statsPill={experimentPill("3 runs", "3 live", "text-blue-500")}
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
      <FeedFinishedCard
        icon={<Code size={16} className="shrink-0" />}
        agentName="backend-refactor"
        title="Refactor auth middleware"
        time="45m ago"
        unread
        onDismiss={onDismiss}
      />
    ),
  },
  {
    type: "artifact",
    render: (onDismiss) => (
      <FeedFinishedCard
        icon={<Code size={16} className="shrink-0" />}
        agentName="brand-asset-generator"
        title="Spring campaign hero images"
        time="2h ago"
        unread
        artifact={{ name: "hero-images-v2.zip" }}
        onDismiss={onDismiss}
      />
    ),
  },
  {
    type: "session",
    render: (onDismiss) => (
      <FeedFinishedCard
        icon={<Time size={16} className="shrink-0" />}
        agentName="brand-asset-generator"
        title="Daily brand audit"
        time="6h ago"
        unread
        scheduled
        onDismiss={onDismiss}
      />
    ),
  },
  {
    type: "artifact",
    render: (onDismiss) => (
      <FeedFinishedCard
        icon={<Time size={16} className="shrink-0" />}
        agentName="reporting-agent"
        title="Nightly performance report"
        time="8h ago"
        unread
        scheduled
        artifact={{ name: "perf-report-aug14.pdf" }}
        onDismiss={onDismiss}
      />
    ),
  },
  {
    type: "experiment",
    render: (onDismiss) => (
      <FeedFinishedCard
        icon={<Chemistry size={16} className="shrink-0" />}
        agentName="color-palette-testing"
        title="Spring palette — warm vs cool tones"
        time="10h ago"
        unread
        statsPill={experimentPill("5 runs", "best 0.87")}
        onDismiss={onDismiss}
      />
    ),
  },
];

const SCHEDULED_CARDS = [
  {
    name: "Daily brand audit",
    cadence: "Every weekday at 9:00 AM",
    nextRun: "in 3h",
    lastResult: "success",
    enabled: true,
    agentName: "brand-asset-generator",
  },
  {
    name: "Nightly test suite",
    cadence: "Every day at 2:00 AM",
    nextRun: "in 14h",
    lastResult: "failed",
    enabled: true,
    agentName: "backend-refactor",
  },
  {
    name: "Weekly report generation",
    cadence: "Every Monday at 8:00 AM",
    nextRun: "in 2d",
    lastResult: "success",
    enabled: true,
    agentName: "reporting-agent",
  },
  {
    name: "Dependency vulnerability scan",
    cadence: "Every 6 hours",
    nextRun: "in 4h",
    lastResult: "success",
    enabled: true,
    agentName: "security-scanner",
  },
  {
    name: "Performance benchmark",
    cadence: "Every day at 3:00 AM",
    nextRun: "in 15h",
    lastResult: "success",
    enabled: true,
    agentName: "perf-monitor",
  },
  {
    name: "Data pipeline sync",
    cadence: "Every 30 minutes",
    nextRun: "in 12m",
    lastResult: "success",
    enabled: true,
    agentName: "data-pipeline",
  },
  {
    name: "Slack digest summary",
    cadence: "Every weekday at 5:00 PM",
    nextRun: "in 7h",
    lastResult: "success",
    enabled: true,
    agentName: "reporting-agent",
  },
  {
    name: "Model fine-tune checkpoint",
    cadence: "Every 12 hours",
    nextRun: "in 8h",
    lastResult: "success",
    enabled: false,
    agentName: "ml-trainer",
  },
  {
    name: "Stale PR cleanup",
    cadence: "Every Friday at 4:00 PM",
    nextRun: "in 4d",
    lastResult: "success",
    enabled: true,
    agentName: "backend-refactor",
  },
  {
    name: "Cost anomaly detector",
    cadence: "Every hour",
    nextRun: "in 45m",
    lastResult: "failed",
    enabled: true,
    agentName: "cost-monitor",
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

export function filterCards(cards: MockCard[], filter: CardType): ReactNode[] {
  if (filter === "all") return cards.map((c) => c.element);
  const typeMap: Record<CardType, string> = {
    all: "",
    sessions: "session",
    experiments: "experiment",
    schedules: "schedule",
    artifacts: "artifact",
  };
  return cards.filter((c) => c.type === typeMap[filter]).map((c) => c.element);
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
              <span
                className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  s.lastResult === "failed"
                    ? "bg-destructive"
                    : "bg-emerald-500",
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
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setModalOpen(false)}
          />
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
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      s.lastResult === "failed"
                        ? "bg-destructive"
                        : "bg-emerald-500",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-foreground truncate">
                      {s.name}
                    </p>
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
  channel?: boolean;
  artifact?: { name: string; fileType: string };
  experiment?: { runs: number; best: string; variants: number };
};

const REVIEW_SESSIONS: ReviewSession[] = [
  // Coding Agent — Finished
  {
    title: "Refactor auth middleware",
    agent: "backend-refactor",
    time: "45m ago",
  },
  // Coding Agent — Finished with artifact
  {
    title: "Generate marketing copy",
    agent: "copywriting-agent",
    time: "1h ago",
    artifact: { name: "campaign-copy-v3.md", fileType: "MD" },
  },
  // Channel — Session Finished (triggered from Slack)
  {
    title: "Research competitor pricing models",
    agent: "market-research-kb",
    time: "30m ago",
    channel: true,
  },
  // Scheduled — Session Finished
  {
    title: "Nightly dependency check",
    agent: "maintenance-bot",
    time: "3h ago",
    scheduled: true,
  },
  // Scheduled — Session Finished with artifact
  {
    title: "Daily brand audit",
    agent: "brand-asset-generator",
    time: "6h ago",
    scheduled: true,
    artifact: { name: "brand-audit-jun14.pdf", fileType: "PDF" },
  },
  // Scheduled — Experiment Finished with dashboard
  {
    title: "Weekly performance regression sweep",
    agent: "perf-testing-agent",
    time: "12h ago",
    scheduled: true,
    experiment: { runs: 86, best: "0.94", variants: 2 },
    artifact: { name: "perf-regression-report", fileType: "HTML" },
  },
  // Experiment — Finished with dashboard
  {
    title: "Spring palette — warm vs cool",
    agent: "color-palette-testing",
    time: "10h ago",
    experiment: { runs: 120, best: "0.87", variants: 3 },
    artifact: { name: "experiment-dashboard", fileType: "HTML" },
  },
];

const MOCK_AGENTS_FOR_SCHEDULE = [
  { id: "1", name: "frontend-agent", kind: undefined as string | undefined },
  { id: "2", name: "backend-refactor", kind: undefined as string | undefined },
  {
    id: "3",
    name: "brand-asset-generator",
    kind: undefined as string | undefined,
  },
  {
    id: "4",
    name: "market-research-kb",
    kind: undefined as string | undefined,
  },
  {
    id: "5",
    name: "color-palette-testing",
    kind: "experiment" as string | undefined,
  },
  {
    id: "6",
    name: "perf-testing-agent",
    kind: "experiment" as string | undefined,
  },
];

function kindLabel(kind: string | undefined) {
  if (kind === "experiment") return "Experiment";
  return "Coding Agent";
}

function HomeCreateScheduleModal({ onClose }: { onClose: () => void }) {
  const [selectedAgent, setSelectedAgent] = useState(
    MOCK_AGENTS_FOR_SCHEDULE[0]!.id,
  );

  const agentPicker = (
    <FormField label="Agent" disableInset>
      <select
        value={selectedAgent}
        onChange={(e) => setSelectedAgent(e.target.value)}
        className="h-[40px] w-full rounded-md border border-border bg-background px-3 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {MOCK_AGENTS_FOR_SCHEDULE.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} — {kindLabel(a.kind)}
          </option>
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
  channel?: boolean;
  experiment?: { runs: number; variants: number };
};

const ACTIVE_SESSIONS: ActiveSession[] = [
  // Coding Agent — Running
  {
    title: "Implement dark mode toggle",
    agent: "frontend-agent",
    duration: "12m",
  },
  // Channel — Running (triggered from Slack)
  {
    title: "Research competitor pricing models",
    agent: "market-research-kb",
    duration: "5m",
    channel: true,
  },
  // Scheduled — Experiment Running
  {
    title: "Weekly performance regression sweep",
    agent: "perf-testing-agent",
    duration: "6m",
    scheduled: true,
    experiment: { runs: 24, variants: 2 },
  },
  // Scheduled — Session Running
  {
    title: "Nightly dependency check",
    agent: "maintenance-bot",
    duration: "3m",
    scheduled: true,
  },
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

/* ═══════════════════════════════════════════════════════════════════════════
   Feed Cards — icon helper + needs-attention card
   ═══════════════════════════════════════════════════════════════════════════ */

function feedIcon(item: {
  scheduled?: boolean;
  experiment?: unknown;
  agent: string;
}) {
  if (item.scheduled) return <Time size={16} className="shrink-0" />;
  if (item.experiment) return <Chemistry size={16} className="shrink-0" />;
  if (item.agent.includes("kb") || item.agent.includes("research"))
    return <Book size={16} className="shrink-0" />;
  return <Code size={16} className="shrink-0" />;
}

function FeedApprovalCard({
  row,
  onResolve,
  onDismiss,
}: {
  row: ApprovalView;
  onResolve?: (label: string) => void;
  onDismiss?: () => void;
}) {
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const agentName = useAgentDisplayName(row.agentId);
  const isNetwork = row.payload.kind === "ext_authz";
  const host = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const method = row.payload.kind === "ext_authz" ? row.payload.method : null;
  const toolName =
    row.payload.kind === "acp_native" ? row.payload.toolName : null;
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;

  const act = (action: () => void, label: string) => {
    action();
    onResolve?.(label);
  };

  return (
    <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
            <span>{agentName}</span>
          </div>
          <p className="text-[15px] font-semibold text-foreground leading-snug">
            {isNetwork ? "Wants to access network" : "Wants to run a command"}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground hover:text-foreground transition-all shrink-0"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
        <span className="font-mono text-[14px] text-muted-foreground">
          {isNetwork ? `${method} ${host}` : toolName}
        </span>
      </div>
      <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
        <span className="text-[14px] text-muted-foreground">just now</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={inflight}
            onClick={() =>
              act(() => approveOnce.mutate({ id: row.id }), "Allowed")
            }
          >
            Allow
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={inflight}
                className="px-2"
              >
                <OverflowMenuVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  act(
                    () => approvePermanent.mutate({ id: row.id }),
                    "Allowed permanently",
                  )
                }
              >
                Allow permanently
              </DropdownMenuItem>
              {host && (
                <DropdownMenuItem
                  onSelect={() =>
                    act(
                      () => approveHost.mutate({ id: row.id }),
                      `Allowed all of ${host}`,
                    )
                  }
                >
                  Allow all of {host}
                </DropdownMenuItem>
              )}
              {!isNetwork && toolName && (
                <DropdownMenuItem
                  onSelect={() =>
                    act(
                      () => approveHost.mutate({ id: row.id }),
                      `Allowed all ${toolName}`,
                    )
                  }
                >
                  Allow all {toolName} commands
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  act(() => dismiss.mutate({ id: row.id }), "Denied")
                }
              >
                Deny this request
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() =>
                  act(
                    () => denyForever.mutate({ id: row.id }),
                    "Denied permanently",
                  )
                }
              >
                Deny permanently
              </DropdownMenuItem>
              <DropdownMenuSeparator className="-mx-1" />
              <DropdownMenuItem
                onSelect={() => navigateToSandboxHome(row.agentId)}
              >
                <Settings size={16} />
                Network settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function ResolvedApprovalCard({
  row,
  resolvedLabel,
  onDismiss,
}: {
  row: ApprovalView;
  resolvedLabel: string;
  onDismiss?: () => void;
}) {
  const agentName = useAgentDisplayName(row.agentId);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const isNetwork = row.payload.kind === "ext_authz";
  const host = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const method = row.payload.kind === "ext_authz" ? row.payload.method : null;
  const toolName =
    row.payload.kind === "acp_native" ? row.payload.toolName : null;
  const isDeny = resolvedLabel.toLowerCase().includes("denied");

  return (
    <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
            <span>{agentName}</span>
          </div>
          <p className="text-[15px] font-semibold text-foreground leading-snug">
            {isNetwork ? "Wants to access network" : "Wants to run a command"}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground hover:text-foreground transition-all shrink-0"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
        <span className="font-mono text-[14px] text-muted-foreground">
          {isNetwork ? `${method} ${host}` : toolName}
        </span>
      </div>
      <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
        <span className="text-[14px] text-muted-foreground">just now</span>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1 text-[14px]",
              isDeny ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <Checkmark size={16} />
            {resolvedLabel}
          </span>
          <button
            type="button"
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => navigateToSandboxHome(row.agentId)}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Feed Dashboard Layout
   ═══════════════════════════════════════════════════════════════════════════ */

const FEED_TABS = [
  "all",
  "attention",
  "agents",
  "experiments",
  "knowledge",
  "schedules",
] as const;
type FeedTab = (typeof FEED_TABS)[number];
const FEED_TAB_LABELS: Record<FeedTab, string> = {
  all: "All",
  attention: "Needs attention",
  agents: "Coding agents",
  experiments: "Experiments",
  knowledge: "Knowledge bases",
  schedules: "Schedules",
};

function FeedFilterDropdown({
  value,
  onChange,
}: {
  value: FeedTab;
  onChange: (v: FeedTab) => void;
}) {
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
                onClick={() => {
                  onChange(tab);
                  setOpen(false);
                }}
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

type FeedStatus = "all" | "attention" | "in-progress" | "unread";

const FEED_STATUS_LABELS: Record<FeedStatus, string> = {
  all: "All",
  attention: "Needs attention",
  "in-progress": "In progress",
  unread: "Unread",
};

const INCLUDE_SOURCES = ["Channels", "Schedules"] as const;

function FeedFilterBar({
  status,
  onStatusChange,
  included,
  onIncludedChange,
}: {
  status: FeedStatus;
  onStatusChange: (v: FeedStatus) => void;
  included: Set<string>;
  onIncludedChange: (v: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggleInclude = (item: string) => {
    const next = new Set(included);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    onIncludedChange(next);
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {FEED_STATUS_LABELS[status]}
          <ChevronDown
            size={16}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </button>
        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-md py-1 min-w-[200px]">
              {(Object.keys(FEED_STATUS_LABELS) as FeedStatus[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onStatusChange(key);
                    setOpen(false);
                  }}
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
              <div className="border-t border-border my-1" />
              <p className="px-3 py-1 text-[12px] text-muted-foreground font-medium uppercase tracking-wide">
                Include
              </p>
              {INCLUDE_SOURCES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleInclude(item)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[14px] text-left transition-colors hover:bg-muted/50"
                >
                  <span
                    className={cn(
                      "flex items-center justify-center w-4 h-4 rounded border transition-colors",
                      included.has(item)
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {included.has(item) && <Checkmark size={12} />}
                  </span>
                  <span
                    className={
                      included.has(item)
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    {item}
                  </span>
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
  const { data: pendingApprovals = [] } = usePendingApprovals();
  const selectAgent = useStore((s) => s.selectAgent);
  const [dismissedReview, setDismissedReview] = useState<Set<number>>(
    new Set(),
  );
  const [_activeTab, _setActiveTab] = useState<FeedTab>("all");
  const [statusFilter, setStatusFilter] = useState<FeedStatus>("all");
  const [includedSources, setIncludedSources] = useState<Set<string>>(
    new Set(INCLUDE_SOURCES),
  );
  const [dismissingReview, setDismissingReview] = useState<Set<number>>(
    new Set(),
  );
  const [collapsingReview, setCollapsingReview] = useState<Set<number>>(
    new Set(),
  );
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);

  const [dismissedActive, setDismissedActive] = useState<Set<number>>(
    new Set(),
  );


  const [previewArtifact, setPreviewArtifact] = useState<LibraryArtifact | null>(null);

  // Approval card animation state
  const [resolvedApprovals, setResolvedApprovals] = useState<
    Map<string, string>
  >(new Map());
  const [dismissingApprovals, setDismissingApprovals] = useState<Set<string>>(
    new Set(),
  );
  const [collapsingApprovals, setCollapsingApprovals] = useState<Set<string>>(
    new Set(),
  );
  const [dismissedApprovals, setDismissedApprovals] = useState<Set<string>>(
    new Set(),
  );

  const resolveApproval = useCallback((id: string, label: string) => {
    setResolvedApprovals((prev) => new Map([...prev, [id, label]]));
  }, []);

  const dismissResolvedApproval = useCallback((id: string) => {
    setDismissingApprovals((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setCollapsingApprovals((prev) => new Set([...prev, id]));
    }, 200);
    setTimeout(() => {
      setDismissedApprovals((prev) => new Set([...prev, id]));
      setDismissingApprovals((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setCollapsingApprovals((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 500);
  }, []);

  const dismissReview = useCallback((idx: number) => {
    setDismissingReview((prev) => new Set([...prev, idx]));
    setTimeout(() => {
      setCollapsingReview((prev) => new Set([...prev, idx]));
    }, 200);
    setTimeout(() => {
      setDismissedReview((prev) => new Set([...prev, idx]));
      setDismissingReview((prev) => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
      setCollapsingReview((prev) => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }, 500);
  }, []);

  const isEmptyState = demoState === "empty";
  const isClearedState =
    demoState === "just-cleared" || demoState === "no-blockers";

  const isSourceIncluded = (item: { scheduled?: boolean; channel?: boolean }) => {
    if (item.scheduled && !includedSources.has("Schedules")) return false;
    if (item.channel && !includedSources.has("Channels")) return false;
    return true;
  };

  const visibleApprovals =
    statusFilter === "all" || statusFilter === "attention"
      ? pendingApprovals.filter((row) => !dismissedApprovals.has(row.id))
      : [];

  const visibleReview =
    isEmptyState || isClearedState
      ? []
      : REVIEW_SESSIONS.filter((item, i) => {
          if (dismissedReview.has(i)) return false;
          if (!isSourceIncluded(item)) return false;
          if (statusFilter === "all") return true;
          if (statusFilter === "unread") return true;
          return false;
        });
  const visibleActive =
    isEmptyState || isClearedState
      ? []
      : ACTIVE_SESSIONS.filter((item, i) => {
          if (dismissedActive.has(i)) return false;
          if (!isSourceIncluded(item)) return false;
          if (statusFilter === "in-progress" || statusFilter === "all")
            return true;
          return false;
        });
  const allCleared =
    isClearedState ||
    (!isEmptyState &&
      visibleActive.length === 0 &&
      visibleReview.length === 0 &&
      visibleApprovals.length === 0);

  const dismissAll = () => {
    const reviewIdxs = REVIEW_SESSIONS.map((_, i) => i).filter(
      (i) => !dismissedReview.has(i),
    );
    const approvalIds = pendingApprovals
      .map((r) => r.id)
      .filter((id) => !dismissedApprovals.has(id));
    setDismissingReview(new Set(reviewIdxs));
    setDismissingApprovals(new Set(approvalIds));
    setTimeout(() => {
      setCollapsingReview(new Set(reviewIdxs));
      setCollapsingApprovals(new Set(approvalIds));
    }, 200);
    setTimeout(() => {
      setDismissedReview(new Set(REVIEW_SESSIONS.map((_, i) => i)));
      setDismissedActive(new Set(ACTIVE_SESSIONS.map((_, i) => i)));
      setDismissedApprovals((prev) => new Set([...prev, ...approvalIds]));
      setDismissingReview(new Set());
      setCollapsingReview(new Set());
      setDismissingApprovals(new Set());
      setCollapsingApprovals(new Set());
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
            securely injected. Create knowledge bases, run experiments to
            compare agent variants, and trigger agents from Slack or on a
            schedule.
          </p>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
            <a
              href={
                import.meta.env.VITE_PROTOTYPE
                  ? "#/agent-setup"
                  : "/agent-setup"
              }
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
                  Work with your preferred coding agent, credentials, and tools
                  in an isolated environment.
                </p>
              </div>
            </a>
            <a
              href={
                import.meta.env.VITE_PROTOTYPE
                  ? "#/experiment-setup"
                  : "/experiment-setup"
              }
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
      )}

      {!isEmptyState && (
        <>
          {/* Greeting — own line */}
          <div className="pb-4">
            <p className="text-[18px] text-muted-foreground mb-1">
              Good morning
            </p>
            <h1 className="text-[40px] font-bold tracking-[-1px] text-foreground leading-none">
              Activity
            </h1>
          </div>

          <div className="grid grid-cols-[1fr_320px] gap-4 items-start">
            {/* LEFT: Feed */}
            <div className="space-y-3">
              {/* Filter + stats */}
              <div className="flex items-center justify-between pb-1">
                <FeedFilterBar
                  status={statusFilter}
                  onStatusChange={setStatusFilter}
                  included={includedSources}
                  onIncludedChange={setIncludedSources}
                />
                {(visibleActive.length > 0 || visibleReview.length > 0) && (
                  <div className="flex items-center gap-4">
                    <p className="text-[14px] text-muted-foreground tabular-nums">
                      <span className="text-foreground font-medium">
                        {visibleActive.length}
                      </span>{" "}
                      running
                      <span className="text-border mx-1.5">·</span>
                      <span className="text-foreground font-medium">
                        {visibleReview.length}
                      </span>{" "}
                      to review
                    </p>
                    <button
                      type="button"
                      className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
                      onClick={dismissAll}
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </div>
              {/* Needs attention — feed-style approval cards (always shown, not counted toward limit) */}
              {visibleApprovals.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    "transition-all",
                    dismissingApprovals.has(row.id) &&
                      "opacity-0 scale-[0.98] duration-200",
                    collapsingApprovals.has(row.id) &&
                      "max-h-0 overflow-hidden opacity-0 !mt-0 duration-300",
                  )}
                >
                  {resolvedApprovals.has(row.id) ? (
                    <ResolvedApprovalCard
                      row={row}
                      resolvedLabel={resolvedApprovals.get(row.id)!}
                      onDismiss={() => dismissResolvedApproval(row.id)}
                    />
                  ) : (
                    <FeedApprovalCard
                      row={row}
                      onResolve={(label) => resolveApproval(row.id, label)}
                      onDismiss={() => dismissResolvedApproval(row.id)}
                    />
                  )}
                </div>
              ))}

              {allCleared && (
                <div className="rounded-xl border border-border bg-card/80 p-10 text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Checkmark size={16} className="text-emerald-500" />
                    <span className="text-[14px] font-medium text-foreground">
                      All clear
                    </span>
                  </div>
                  <p className="text-[14px] text-muted-foreground">
                    Nothing waiting for review. You're all caught up.
                  </p>
                </div>
              )}

              {/* Active + Review cards — capped by feedLimit */}
              {(() => {
                const allFeedItems = [
                  ...visibleActive.map((item) => ({
                    type: "active" as const,
                    item,
                    idx: ACTIVE_SESSIONS.indexOf(item),
                  })),
                  ...visibleReview.map((item) => ({
                    type: "review" as const,
                    item,
                    idx: REVIEW_SESSIONS.indexOf(item),
                  })),
                ];
                return (
                  <>
                    {allFeedItems.map((entry) => {
                      if (entry.type === "active") {
                        return (
                          <FeedActiveCard
                            key={`active-${entry.idx}`}
                            icon={feedIcon(entry.item)}
                            agentName={entry.item.agent}
                            title={entry.item.title}
                            duration={entry.item.duration}
                            scheduled={entry.item.scheduled}
                            statsPill={
                              entry.item.experiment
                                ? experimentPill(
                                    `${entry.item.experiment.runs} runs`,
                                    `${entry.item.experiment.variants} live`,
                                    "text-blue-500",
                                  )
                                : undefined
                            }
                            onClick={() => selectAgent(entry.item.agent)}
                          />
                        );
                      }
                      return (
                        <div
                          key={`review-${entry.idx}`}
                          className={cn(
                            "transition-all",
                            dismissingReview.has(entry.idx) &&
                              "opacity-0 scale-[0.98] duration-200",
                            collapsingReview.has(entry.idx) &&
                              "max-h-0 overflow-hidden opacity-0 !mt-0 duration-300",
                          )}
                        >
                          <FeedFinishedCard
                            icon={feedIcon(entry.item)}
                            agentName={entry.item.agent}
                            title={entry.item.title}
                            time={entry.item.time}
                            unread
                            scheduled={entry.item.scheduled}
                            artifact={
                              entry.item.artifact
                                ? { name: entry.item.artifact.name }
                                : undefined
                            }
                            statsPill={
                              entry.item.experiment
                                ? experimentPill(
                                    `${entry.item.experiment.runs} runs`,
                                    `best ${entry.item.experiment.best}`,
                                  )
                                : undefined
                            }
                            onClick={() => selectAgent(entry.item.agent)}
                            onDismiss={() => dismissReview(entry.idx)}
                            onArtifactClick={
                              entry.item.artifact
                                ? () =>
                                    setPreviewArtifact({
                                      id: `mock-${entry.idx}`,
                                      title: entry.item.artifact!.name,
                                      slug: entry.item.artifact!.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                                      kind: entry.item.artifact!.fileType === "HTML" ? "html" : entry.item.artifact!.fileType === "MD" ? "markdown" : "binary",
                                      contentType: entry.item.artifact!.fileType === "HTML" ? "text/html" : entry.item.artifact!.fileType === "MD" ? "text/markdown" : "application/octet-stream",
                                      fileName: entry.item.artifact!.name,
                                      sizeBytes: 4096,
                                      version: 1,
                                      folderId: null,
                                      agentId: entry.item.agent,
                                      visibility: "private",
                                      expiresAt: null,
                                      viewCount: 0,
                                      shareUrl: null,
                                      createdAt: new Date().toISOString(),
                                      updatedAt: new Date().toISOString(),
                                    })
                                : undefined
                            }
                          />
                        </div>
                      );
                    })}

                  </>
                );
              })()}
            </div>

            {/* RIGHT: Sidebar — Compute + Spend + Schedules */}
            <div className="space-y-4 pt-[37px]">
              <ComputePreview />
              <SpendPreview />
              <ScheduleOverviewWidget />
            </div>
          </div>
        </>
      )}

      {showCreateSchedule && (
        <HomeCreateScheduleModal onClose={() => setShowCreateSchedule(false)} />
      )}

      {previewArtifact && (
        <ArtifactPreviewDialog
          artifact={previewArtifact}
          onClose={() => setPreviewArtifact(null)}
        />
      )}
    </div>
  );
}
