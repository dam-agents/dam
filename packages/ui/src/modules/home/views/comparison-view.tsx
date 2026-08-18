import {
  Add,
  Book,
  Chat,
  Checkmark,
  Chemistry,
  Close,
  Code,
  Document,
  Folders,
  Hashtag,
  OverflowMenuVertical,
  Settings,
  Time,
  WarningAlt,
} from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Globe,
  MoreHorizontal,
  ShieldOff,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import {
  useApproveHost,
  useApproveOnce,
  useApprovePermanent,
  useDenyForever,
  useDismissApproval,
} from "../../approvals/api/mutations.js";
import { usePendingApprovals } from "../../approvals/api/queries.js";
import { isHeldCallStillLive } from "../../approvals/lib/hold.js";
import { ArtifactPreviewDialog } from "../../artifacts/components/artifact-preview-dialog.js";
import { ScheduleFormModal } from "../../schedules/forms/schedule-form-modal.js";
import { WorkingDots } from "../../sessions/components/working-dots.js";
import {
  seedMockSessions,
  setMockFromHomePage,
} from "../../sessions/views/chat-view.js";
import { DURATION_TICK_MS } from "../home-thresholds.js";

function useTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), DURATION_TICK_MS);
    return () => clearInterval(id);
  }, []);
}

export function ComparisonView() {
  useTick();
  const { data: pendingApprovals } = usePendingApprovals();

  const networkApprovals = (pendingApprovals ?? []).filter(
    (a) => a.payload.kind === "ext_authz",
  );
  const toolApprovals = (pendingApprovals ?? []).filter(
    (a) => a.payload.kind === "acp_native",
  );

  return (
    <div className="space-y-12 max-w-3xl pb-20">
      <div>
        <h1 className="text-[22px] font-bold text-foreground">
          Home Page Card Types — Review
        </h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Only cards backed by real data from the main branch. Each shows real
          fields from the API.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
         CODING AGENTS
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Coding Agents" />

      <FeedCodingAgentCards />

      {/* ═══════════════════════════════════════════════════════════════
         KNOWLEDGE BASES
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Knowledge Bases" />

      <FeedKnowledgeBaseCards />

      {/* ═══════════════════════════════════════════════════════════════
         EXPERIMENTS
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Experiments" />

      <FeedExperimentCards />

      {/* ═══════════════════════════════════════════════════════════════
         CHANNELS (Slack-triggered)
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Channels" />

      <FeedChannelCards />

      {/* ═══════════════════════════════════════════════════════════════
         NEEDS ATTENTION
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Needs Attention" />

      <FeedNeedsAttentionCards />

      {/* ═══════════════════════════════════════════════════════════════
         SIDEBAR WIDGETS
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Sidebar Widgets" />

      <CardEntry
        number={0}
        title="Compute Resources"
        description="Interactive cell meter showing CPU/memory usage."
      >
        <div className="space-y-4 max-w-xs">
          <ComputePreview />
        </div>
      </CardEntry>

      <CardEntry
        number={1}
        title="Schedules Overview"
        description="Read-only list of all schedules sorted by next run. Shows top 5 in the sidebar; 'See all' opens a modal with the full list. No toggles — click a schedule to navigate to its config page."
      >
        <div className="max-w-[320px]">
          <ScheduleOverviewWidget />
        </div>
      </CardEntry>

      {/* ═══════════════════════════════════════════════════════════════
         FILTER VARIATIONS
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Filter Variations" />

      <FilterVariations />

      {/* ═══════════════════════════════════════════════════════════════
         FEED LENGTH — SIDEBAR VISIBILITY
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Feed Length — Sidebar Visibility" />

      <FeedLengthOptions />
    </div>
  );
}

function FeedLengthOptions() {
  return (
    <div className="space-y-8">
      <p className="text-[14px] text-muted-foreground max-w-lg">
        The 3 sidebar widgets (Compute + Spend + Schedules) can't all show on
        screen at once without scrolling. Options for keeping everything
        reachable:
      </p>

      {/* Option A: Paginated feed */}
      <CardEntry
        number={1}
        title="Option A — Paginate Feed"
        description="Show 10 cards per page. Short feed means sidebar is fully visible without scrolling. Simple numbered pagination at bottom of feed."
      >
        <div className="rounded-2xl border border-border bg-card/80 p-5 w-full max-w-lg">
          <div className="space-y-2">
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
            <p className="text-[14px] text-muted-foreground text-center py-1">
              … 10 cards max …
            </p>
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
          </div>
          <div className="flex items-center justify-center gap-2 pt-4 mt-4 border-t border-border">
            <span className="text-[14px] text-muted-foreground">←</span>
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-foreground text-background text-[14px] font-medium">
              1
            </span>
            <span className="flex items-center justify-center w-7 h-7 rounded-md text-[14px] text-muted-foreground hover:bg-muted">
              2
            </span>
            <span className="flex items-center justify-center w-7 h-7 rounded-md text-[14px] text-muted-foreground hover:bg-muted">
              3
            </span>
            <span className="text-[14px] text-muted-foreground">→</span>
          </div>
        </div>
      </CardEntry>

      {/* Option B: Load more */}
      <CardEntry
        number={2}
        title="Option B — Load More"
        description="Show first 6 cards, then a 'Show more' button. Less formal than pagination, more natural for a feed. Sidebar is visible on initial load."
      >
        <div className="rounded-2xl border border-border bg-card/80 p-5 w-full max-w-lg">
          <div className="space-y-2">
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
            <div className="h-8 rounded-lg bg-muted/40 border border-border/50" />
          </div>
          <div className="flex justify-center pt-4 mt-4 border-t border-border">
            <button
              type="button"
              className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Show 7 more ↓
            </button>
          </div>
        </div>
      </CardEntry>

      {/* Option C: Compact sidebar */}
      <CardEntry
        number={3}
        title="Option C — Compact Sidebar (Tabbed)"
        description="Combine Compute + Spend into one tabbed widget. Reduces sidebar height by ~40%, makes Schedules visible without scrolling even with a long feed."
      >
        <div className="w-[320px] space-y-4">
          {/* Combined compute/spend widget */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-1 mb-3">
              <button
                type="button"
                className="px-2.5 py-1 rounded-md bg-foreground text-background text-[14px] font-medium"
              >
                Compute
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md text-[14px] text-muted-foreground"
              >
                Spend
              </button>
            </div>
            <div className="h-[100px] rounded-lg bg-muted/30 border border-border/50 flex items-center justify-center">
              <span className="text-[14px] text-muted-foreground">
                Compute or Spend content
              </span>
            </div>
          </div>
          {/* Schedules stays as-is */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[15px] font-semibold text-foreground">
                Schedules{" "}
                <span className="text-[14px] font-normal text-muted-foreground">
                  (10)
                </span>
              </span>
              <span className="text-[14px] text-muted-foreground">See all</span>
            </div>
            <div className="space-y-1">
              <div className="h-7 rounded bg-muted/30" />
              <div className="h-7 rounded bg-muted/30" />
              <div className="h-7 rounded bg-muted/30" />
              <div className="h-7 rounded bg-muted/30" />
              <div className="h-7 rounded bg-muted/30" />
            </div>
          </div>
        </div>
      </CardEntry>

      {/* Option D: Sticky sidebar with internal scroll */}
      <CardEntry
        number={4}
        title="Option D — Sidebar Internal Scroll"
        description="Keep sidebar sticky but cap its height to viewport. If all 3 widgets don't fit, the sidebar scrolls internally. Feed scrolls normally. No changes to feed length."
      >
        <div className="w-[320px] rounded-2xl border border-border bg-card p-4 max-h-[300px] overflow-y-auto">
          <p className="text-[14px] text-muted-foreground mb-3">
            Sticky sidebar with{" "}
            <code className="text-[14px]">max-h-[calc(100vh-2rem)]</code> and{" "}
            <code className="text-[14px]">overflow-y-auto</code>
          </p>
          <div className="space-y-3">
            <div className="h-[80px] rounded-lg bg-muted/30 border border-border/50 flex items-center justify-center">
              <span className="text-[14px] text-muted-foreground">Compute</span>
            </div>
            <div className="h-[80px] rounded-lg bg-muted/30 border border-border/50 flex items-center justify-center">
              <span className="text-[14px] text-muted-foreground">Spend</span>
            </div>
            <div className="h-[120px] rounded-lg bg-muted/30 border border-border/50 flex items-center justify-center">
              <span className="text-[14px] text-muted-foreground">
                Schedules
              </span>
            </div>
          </div>
        </div>
      </CardEntry>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Layout helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-t border-border pt-8">
      <h2 className="text-[18px] font-bold text-foreground">{title}</h2>
    </div>
  );
}

function CardEntry({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[14px] font-medium text-muted-foreground mb-1">
          Card {number}
        </p>
        <h2 className="text-[18px] font-semibold text-foreground">{title}</h2>
        <p className="text-[14px] text-muted-foreground mt-1 leading-relaxed max-w-prose">
          {description}
        </p>
      </div>
      {children}
      <div className="border-b border-border pt-4" />
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
      <p className="text-[14px] text-muted-foreground">{label}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Card 1–2: Approval cards (real component from blocked-section)
   ═══════════════════════════════════════════════════════════════════════════ */

function useCountdown(expiresAt: string): number | null {
  const [remaining, setRemaining] = useState<number | null>(() => {
    const ms = Date.parse(expiresAt) - Date.now();
    return ms > 0 ? Math.ceil(ms / 1000) : null;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const ms = Date.parse(expiresAt) - Date.now();
      setRemaining(ms > 0 ? Math.ceil(ms / 1000) : null);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}

export function ApprovalCardPreview({ row }: { row: ApprovalView }) {
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const agentName = useAgentDisplayName(row.agentId);

  const live = isHeldCallStillLive(row);
  const countdown = useCountdown(row.expiresAt);
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;

  const isNetwork = row.payload.kind === "ext_authz";
  const host = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const method = row.payload.kind === "ext_authz" ? row.payload.method : null;
  const path = row.payload.kind === "ext_authz" ? row.payload.path : null;
  const toolName =
    row.payload.kind === "acp_native" ? row.payload.toolName : null;
  const toolArgs =
    row.payload.kind === "acp_native" ? row.payload.args : undefined;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          className="text-[14px] font-medium text-foreground hover:text-accent transition-colors truncate"
          onClick={() => navigateToSandboxHome(row.agentId)}
        >
          {agentName}
        </button>
        <Badge variant={isNetwork ? "info" : "muted"} size="sm">
          {isNetwork ? "Network" : "Tool"}
        </Badge>
        <span className="ml-auto text-[14px] text-muted-foreground shrink-0">
          {formatRelativeTime(row.createdAt)}
        </span>
      </div>

      <div className="rounded-md bg-muted/50 px-3 py-2 mb-3">
        {isNetwork ? (
          <div className="space-y-0.5">
            <p className="font-mono text-[14px] font-semibold text-foreground">
              {method} {host}
            </p>
            <p className="font-mono text-[14px] text-muted-foreground truncate">
              {path}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            <p className="font-mono text-[14px] font-semibold text-foreground">
              {toolName}
            </p>
            {toolArgs != null && (
              <pre className="font-mono text-[14px] text-muted-foreground overflow-x-auto max-h-[60px]">
                {typeof toolArgs === "string"
                  ? toolArgs
                  : JSON.stringify(toolArgs as object, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={inflight}>
              <Check size={14} />
              Allow
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              disabled={isNetwork ? !live : false}
              onSelect={() => approveOnce.mutate({ id: row.id })}
            >
              <Check size={14} />
              <span>Allow this request</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => approvePermanent.mutate({ id: row.id })}
            >
              <CheckCheck size={14} />
              <span>
                Allow permanently
                <span className="ml-1 text-muted-foreground">
                  — writes a rule
                </span>
              </span>
            </DropdownMenuItem>
            {host && (
              <DropdownMenuItem
                onSelect={() => approveHost.mutate({ id: row.id })}
                className="text-warning"
              >
                <Globe size={14} />
                <span>
                  Allow all of {host}
                  <span className="ml-1 text-muted-foreground">
                    — wildcard rule
                  </span>
                </span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              tone="danger"
              size="sm"
              disabled={inflight}
            >
              <X size={14} />
              Deny
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              disabled={!live}
              onSelect={() => dismiss.mutate({ id: row.id })}
            >
              <X size={14} />
              <span>Deny this request</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              tone="danger"
              onSelect={() => denyForever.mutate({ id: row.id })}
            >
              <ShieldOff size={14} />
              <span>
                Deny permanently
                <span className="ml-1 text-muted-foreground">
                  — writes a rule
                </span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {isNetwork && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToSandboxHome(row.agentId)}
            title="Open agent network settings"
          >
            <Settings size={16} />
          </Button>
        )}
      </div>

      {countdown !== null && countdown <= 30 && (
        <div className="flex items-center gap-1 text-[14px] text-warning mt-3">
          <WarningAlt size={14} />
          <span>Expires in {countdown}s</span>
        </div>
      )}
      {countdown === null && isNetwork && (
        <p className="text-[14px] text-muted-foreground mt-3">
          Original request timed out. Permanent rules still apply to future
          attempts.
        </p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cards 3, 8: Experiment cards
   Fields from Experiment: name, status, error, driverAgentId
   Fields from ExperimentDriverSummary: runningInvocations
   ═══════════════════════════════════════════════════════════════════════════ */

export function ExperimentCard({
  agentName,
  experimentName,
  status,
  runningInvocations,
  completedRuns,
  onDismiss,
}: {
  agentName: string;
  experimentName: string;
  status: "draft" | "running" | "completed" | "failed" | "stopped";
  runningInvocations: number;
  completedRuns?: number;
  onDismiss?: () => void;
}) {
  const navigateToExperiments = useStore((s) => s.navigateToExperiments);
  const [stopped, setStopped] = useState(false);

  if (stopped) {
    return (
      <Card className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4">
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
          <Chemistry size={16} className="text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[16px] text-foreground">
              {experimentName}
            </h3>
          </div>
          <p className="mt-1 text-[14px] text-success">Experiment stopped</p>
        </div>
        <Button size="sm" variant="outline" onClick={navigateToExperiments}>
          Open
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4">
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
        <Chemistry size={16} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[16px] text-foreground">
            {experimentName}
          </h3>
        </div>
        <p className="mt-1 truncate text-[14px] text-muted-foreground">
          {status === "running" && runningInvocations > 0
            ? `${runningInvocations} invocation${runningInvocations !== 1 ? "s" : ""} running`
            : status === "completed"
              ? `${completedRuns ?? 5} runs completed`
              : agentName}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {status === "running" && (
          <>
            <Button size="sm" variant="outline" onClick={navigateToExperiments}>
              Open
            </Button>
            <Button
              size="sm"
              variant="outline"
              tone="danger"
              className="text-danger border-danger"
              onClick={() => setStopped(true)}
            >
              Stop
            </Button>
          </>
        )}
        {status === "completed" && (
          <>
            <Button size="sm" variant="outline" onClick={navigateToExperiments}>
              View results
            </Button>
            {onDismiss && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={onDismiss}
              >
                Dismiss
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cards 4, 5, 7: Schedule cards
   Fields from Schedule: name, type, cron/rrule, enabled,
   status.nextRun, status.lastRun, status.lastResult
   ═══════════════════════════════════════════════════════════════════════════ */

export function ScheduleCard({
  name,
  cadence,
  nextRun,
  lastResult,
  onDismiss,
}: {
  name: string;
  cadence: string;
  nextRun: string;
  lastResult: string;
  enabled?: boolean;
  onDismiss?: () => void;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const isFailed = lastResult.startsWith("failed");

  const openSchedule = () => {
    navigateToSandboxHome("a1b2c3d4-0001-4000-8000-000000000001", "schedules");
  };

  return (
    <Card className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4">
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
        <Time size={16} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[16px] text-foreground">{name}</h3>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[14px] text-muted-foreground">
          <span className="truncate">{cadence}</span>
          <span aria-hidden>·</span>
          <span className="whitespace-nowrap">next {nextRun}</span>
        </div>
        {isFailed && (
          <p className="mt-1 text-[14px] text-danger truncate">
            Last run: {lastResult}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={openSchedule}>
          Edit schedule
        </Button>
        {onDismiss && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Card 3: Session still running
   Fields from SessionView: title, agentId, running, updatedAt
   ═══════════════════════════════════════════════════════════════════════════ */

export function SessionRunningCard({
  title,
  agentName,
  updatedAt,
}: {
  title: string;
  agentName: string;
  updatedAt: string;
}) {
  const selectAgent = useStore((s) => s.selectAgent);
  const [stopped, setStopped] = useState(false);
  const open = () => {
    seedMockSessions("a1b2c3d4-0001-4000-8000-000000000001");
    setMockFromHomePage(true);
    selectAgent("a1b2c3d4-0001-4000-8000-000000000001");
  };

  if (stopped) {
    return (
      <Card className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4">
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
          <Chat size={20} className="text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[16px] text-foreground">{title}</h3>
          </div>
          <p className="mt-1 text-[14px] text-success">Session stopped</p>
        </div>
        <Button size="sm" variant="outline" onClick={open}>
          View session
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4">
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
        <Chat size={20} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[16px] text-foreground">{title}</h3>
          <WorkingDots className="text-accent shrink-0" size="sm" />
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {agentName} · {updatedAt}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="outline" onClick={open}>
          View session
        </Button>
        <Button
          size="sm"
          variant="outline"
          tone="danger"
          className="text-danger border-danger"
          onClick={() => setStopped(true)}
        >
          Stop
        </Button>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cards 6–9: Session finished (unread)
   Fields from SessionView: title, agentId, running, updatedAt, seenAt
   ═══════════════════════════════════════════════════════════════════════════ */

export function SessionFinishedCard({
  title,
  agentName,
  updatedAt,
  scheduled,
  onDismiss,
}: {
  title: string;
  agentName: string;
  updatedAt: string;
  scheduled: boolean;
  onDismiss?: () => void;
}) {
  const selectAgent = useStore((s) => s.selectAgent);
  const open = () => {
    seedMockSessions("a1b2c3d4-0001-4000-8000-000000000001");
    setMockFromHomePage(true);
    selectAgent("a1b2c3d4-0001-4000-8000-000000000001");
  };
  return (
    <Card className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4">
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
        {scheduled ? (
          <Time size={16} className="text-muted-foreground" />
        ) : (
          <Chat size={16} className="text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[16px] text-foreground">{title}</h3>
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {agentName} · {updatedAt}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={open}>
          {scheduled ? "View results" : "View session"}
        </Button>
        {onDismiss && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Artifact Card
   An artifact produced by an agent, shown independently.
   ═══════════════════════════════════════════════════════════════════════════ */

export function ArtifactCard({
  title,
  agentName,
  updatedAt,
  artifactId = "art-1",
  onDismiss,
}: {
  title: string;
  agentName: string;
  updatedAt: string;
  artifactId?: string;
  onDismiss?: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const mockArtifact = {
    id: artifactId,
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    kind: "markdown" as const,
    contentType: "text/markdown",
    fileName: `${title.toLowerCase().replace(/\s+/g, "-")}.md`,
    sizeBytes: 4200,
    version: 1,
    folderId: null,
    agentId: "a1b2c3d4-0001-4000-8000-000000000001",
    visibility: "private" as const,
    expiresAt: null,
    viewCount: 3,
    shareUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return (
    <>
      <Card className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4">
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
          <Folders size={16} className="text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[16px] text-foreground">{title}</h3>
          </div>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {agentName} · {updatedAt}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPreviewOpen(true)}
          >
            View artifact
          </Button>
          {onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={onDismiss}
            >
              Dismiss
            </Button>
          )}
        </div>
      </Card>
      {previewOpen && (
        <ArtifactPreviewDialog
          artifact={mockArtifact}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════════════════════ */

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - Date.parse(dateStr);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Approval Card Redesign Variants
   ═══════════════════════════════════════════════════════════════════════════ */

function ApprovalCardVariants({
  networkRow,
  toolRow,
}: {
  networkRow: ApprovalView;
  toolRow?: ApprovalView;
}) {
  const [option, setOption] = useState(1);
  const rows = [networkRow, toolRow].filter(Boolean) as ApprovalView[];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[14px] text-muted-foreground font-medium">
          Option:
        </span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setOption(n)}
            className={cn(
              "w-7 h-7 rounded-md text-[14px] font-medium transition-colors",
              option === n
                ? "bg-accent text-white"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {n}
          </button>
        ))}
        <span className="text-[14px] text-muted-foreground ml-2">
          {option === 1 && "Focus + overflow"}
          {option === 2 && "Expandable detail"}
          {option === 3 && "Two-action primary"}
          {option === 4 && "Minimal row"}
          {option === 5 && "Split layout"}
        </span>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id}>
            {option === 1 && <ApprovalVariant1 row={row} />}
            {option === 2 && <ApprovalVariant2 row={row} />}
            {option === 3 && <ApprovalVariant3 row={row} />}
            {option === 4 && <ApprovalVariant4 row={row} />}
            {option === 5 && <ApprovalVariant5 row={row} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApprovalVariant1({
  row,
  onDismiss,
}: {
  row: ApprovalView;
  onDismiss?: (id: string) => void;
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

  const act = (action: () => void) => {
    action();
    onDismiss?.(row.id);
  };

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] text-foreground truncate">
            {agentName}
            <span className="text-muted-foreground font-normal text-[14px] ml-2">
              wants to {isNetwork ? "access" : "use"}
            </span>
          </p>
          <p className="font-mono text-[14px] text-muted-foreground mt-0.5 truncate">
            {isNetwork ? `${method} ${host}` : toolName}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            disabled={inflight}
            onClick={() => act(() => approveOnce.mutate({ id: row.id }))}
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
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  act(() => approvePermanent.mutate({ id: row.id }))
                }
              >
                <CheckCheck size={14} />
                <span>Allow permanently</span>
              </DropdownMenuItem>
              {host && (
                <DropdownMenuItem
                  onSelect={() => act(() => approveHost.mutate({ id: row.id }))}
                >
                  <Globe size={14} />
                  <span>Allow all of {host}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => act(() => dismiss.mutate({ id: row.id }))}
              >
                <X size={14} />
                <span>Deny this request</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                tone="danger"
                onSelect={() => act(() => denyForever.mutate({ id: row.id }))}
              >
                <ShieldOff size={14} />
                <span>Deny permanently</span>
              </DropdownMenuItem>
              {isNetwork && (
                <DropdownMenuItem
                  onSelect={() => navigateToSandboxHome(row.agentId)}
                >
                  <Settings size={14} />
                  <span>Network settings</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function ApprovalVariant2({ row }: { row: ApprovalView }) {
  const [expanded, setExpanded] = useState(false);
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const agentName = useAgentDisplayName(row.agentId);
  const isNetwork = row.payload.kind === "ext_authz";
  const host = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const method = row.payload.kind === "ext_authz" ? row.payload.method : null;
  const path = row.payload.kind === "ext_authz" ? row.payload.path : null;
  const toolName =
    row.payload.kind === "acp_native" ? row.payload.toolName : null;
  const toolArgs =
    row.payload.kind === "acp_native" ? row.payload.args : undefined;
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-foreground truncate">
              {agentName}
            </span>
            <span className="text-[14px] text-muted-foreground">·</span>
            <span className="font-mono text-[14px] text-muted-foreground truncate">
              {isNetwork ? `${method} ${host}` : toolName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            disabled={inflight}
            onClick={() => approveOnce.mutate({ id: row.id })}
          >
            Allow
          </Button>
          <Button
            variant="outline"
            tone="danger"
            size="sm"
            disabled={inflight}
            onClick={() => dismiss.mutate({ id: row.id })}
          >
            Deny
          </Button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <ChevronRight
              size={16}
              className={cn("transition-transform", expanded && "rotate-90")}
            />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-muted/20">
          <div className="rounded-md bg-muted/50 px-3 py-2 mb-3">
            {isNetwork ? (
              <div className="space-y-0.5">
                <p className="font-mono text-[14px] font-semibold text-foreground">
                  {method} {host}
                </p>
                <p className="font-mono text-[14px] text-muted-foreground truncate">
                  {path}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                <p className="font-mono text-[14px] font-semibold text-foreground">
                  {toolName}
                </p>
                {toolArgs != null && (
                  <pre className="font-mono text-[14px] text-muted-foreground overflow-x-auto max-h-[60px]">
                    {typeof toolArgs === "string"
                      ? toolArgs
                      : JSON.stringify(toolArgs as object, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              disabled={inflight}
              onClick={() => approvePermanent.mutate({ id: row.id })}
            >
              <CheckCheck size={14} />
              Allow permanently
            </Button>
            {host && (
              <Button
                variant="outline"
                size="sm"
                disabled={inflight}
                onClick={() => approveHost.mutate({ id: row.id })}
              >
                <Globe size={14} />
                Allow all of {host}
              </Button>
            )}
            <Button
              variant="outline"
              tone="danger"
              size="sm"
              disabled={inflight}
              onClick={() => denyForever.mutate({ id: row.id })}
            >
              <ShieldOff size={14} />
              Deny permanently
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalVariant3({ row }: { row: ApprovalView }) {
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
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

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[14px] text-muted-foreground">{agentName}</span>
        <span className="text-[14px] text-muted-foreground">·</span>
        <span className="text-[14px] text-muted-foreground">
          {isNetwork ? "network" : "tool"}
        </span>
        <span className="ml-auto text-[14px] text-muted-foreground tabular-nums">
          {formatRelativeTime(row.createdAt)}
        </span>
      </div>
      <p className="font-mono text-[16px] text-foreground truncate mb-3">
        {isNetwork ? `${method} ${host}` : toolName}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={inflight}
          onClick={() => approveOnce.mutate({ id: row.id })}
        >
          <Check size={14} />
          Allow once
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={inflight}
          onClick={() => approvePermanent.mutate({ id: row.id })}
        >
          <CheckCheck size={14} />
          Always allow
        </Button>
        <div className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={inflight}
                className="text-muted-foreground px-2"
              >
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {host && (
                <DropdownMenuItem
                  onSelect={() => approveHost.mutate({ id: row.id })}
                >
                  <Globe size={14} />
                  <span>Allow all of {host}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => dismiss.mutate({ id: row.id })}>
                <X size={14} />
                <span>Deny this request</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                tone="danger"
                onSelect={() => denyForever.mutate({ id: row.id })}
              >
                <ShieldOff size={14} />
                <span>Deny permanently</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function ApprovalVariant4({ row }: { row: ApprovalView }) {
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
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

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isNetwork ? (
          <Globe size={16} className="text-muted-foreground shrink-0" />
        ) : (
          <Settings size={16} className="text-muted-foreground shrink-0" />
        )}
        <span className="text-[14px] font-medium text-foreground shrink-0">
          {agentName}
        </span>
        <span className="font-mono text-[14px] text-muted-foreground truncate">
          {isNetwork ? `${method} ${host}` : toolName}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          disabled={inflight}
          onClick={() => approveOnce.mutate({ id: row.id })}
        >
          Allow
        </Button>
        <Button
          variant="outline"
          tone="danger"
          size="sm"
          disabled={inflight}
          onClick={() => dismiss.mutate({ id: row.id })}
        >
          Deny
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={inflight}
              className="px-1.5"
            >
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => approvePermanent.mutate({ id: row.id })}
            >
              <CheckCheck size={14} />
              <span>Allow permanently</span>
            </DropdownMenuItem>
            {host && (
              <DropdownMenuItem
                onSelect={() => approveHost.mutate({ id: row.id })}
              >
                <Globe size={14} />
                <span>Allow all of {host}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              tone="danger"
              onSelect={() => denyForever.mutate({ id: row.id })}
            >
              <ShieldOff size={14} />
              <span>Deny permanently</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ApprovalVariant5({ row }: { row: ApprovalView }) {
  const [expanded, setExpanded] = useState(false);
  const approveOnce = useApproveOnce();
  const approvePermanent = useApprovePermanent();
  const approveHost = useApproveHost();
  const denyForever = useDenyForever();
  const dismiss = useDismissApproval();
  const agentName = useAgentDisplayName(row.agentId);
  const isNetwork = row.payload.kind === "ext_authz";
  const host = row.payload.kind === "ext_authz" ? row.payload.host : null;
  const method = row.payload.kind === "ext_authz" ? row.payload.method : null;
  const path = row.payload.kind === "ext_authz" ? row.payload.path : null;
  const toolName =
    row.payload.kind === "acp_native" ? row.payload.toolName : null;
  const toolArgs =
    row.payload.kind === "acp_native" ? row.payload.args : undefined;
  const inflight =
    approveOnce.isPending ||
    approvePermanent.isPending ||
    approveHost.isPending ||
    denyForever.isPending ||
    dismiss.isPending;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            {isNetwork ? (
              <Globe size={18} className="text-accent" />
            ) : (
              <Settings size={18} className="text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] text-foreground">
              <span className="font-medium">{agentName}</span>
              <span className="text-muted-foreground">
                {" "}
                wants to {isNetwork ? "connect to" : "run"}{" "}
              </span>
              <span className="font-mono font-medium">
                {isNetwork ? host : toolName}
              </span>
            </p>
            {expanded && (
              <div className="mt-2 rounded-md bg-muted/50 px-3 py-2">
                {isNetwork ? (
                  <p className="font-mono text-[14px] text-muted-foreground truncate">
                    {method} {host}
                    {path}
                  </p>
                ) : toolArgs != null ? (
                  <pre className="font-mono text-[14px] text-muted-foreground overflow-x-auto max-h-[60px]">
                    {typeof toolArgs === "string"
                      ? toolArgs
                      : JSON.stringify(toolArgs as object, null, 2)}
                  </pre>
                ) : null}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[14px] text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
          >
            {expanded ? "Less" : "Details"}
          </button>
        </div>
      </div>
      <div className="border-t border-border px-4 py-2.5 flex items-center gap-2 bg-muted/10">
        <Button
          size="sm"
          disabled={inflight}
          onClick={() => approveOnce.mutate({ id: row.id })}
        >
          Allow once
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={inflight}
          onClick={() => approvePermanent.mutate({ id: row.id })}
        >
          Always
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          tone="danger"
          size="sm"
          disabled={inflight}
          onClick={() => dismiss.mutate({ id: row.id })}
        >
          Deny
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={inflight}
              className="px-1.5 text-muted-foreground"
            >
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {host && (
              <DropdownMenuItem
                onSelect={() => approveHost.mutate({ id: row.id })}
              >
                <Globe size={14} />
                <span>Allow all of {host}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              tone="danger"
              onSelect={() => denyForever.mutate({ id: row.id })}
            >
              <ShieldOff size={14} />
              <span>Deny permanently</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Cards 12–13: Static previews of resource widgets
   ═══════════════════════════════════════════════════════════════════════════ */

export function SpendPreview() {
  const [period, setPeriod] = useState(2);

  const spendByPeriod = [
    {
      total: "$4.82",
      spenders: [
        { name: "frontend-agent", cost: 2.1 },
        { name: "brand-asset-generator", cost: 1.64 },
        { name: "backend-refactor", cost: 1.08 },
      ],
    },
    {
      total: "$18.43",
      spenders: [
        { name: "frontend-agent", cost: 8.12 },
        { name: "brand-asset-generator", cost: 5.91 },
        { name: "backend-refactor", cost: 4.4 },
      ],
    },
    {
      total: "$31.57",
      spenders: [
        { name: "frontend-agent", cost: 12.47 },
        { name: "brand-asset-generator", cost: 8.23 },
        { name: "backend-refactor", cost: 5.91 },
      ],
    },
    {
      total: "$284.19",
      spenders: [
        { name: "frontend-agent", cost: 112.3 },
        { name: "brand-asset-generator", cost: 89.47 },
        { name: "backend-refactor", cost: 52.42 },
      ],
    },
  ];

  const current = spendByPeriod[period];
  const maxCost = current.spenders[0].cost;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 flex flex-col">
      <div className="flex items-center justify-between mb-1 min-h-[32px]">
        <p className="text-[14px] text-muted-foreground">Spend</p>
        <div className="flex gap-0.5 rounded-md bg-muted/40 border border-border/50 p-0.5 shrink-0">
          {["1d", "1w", "1m", "1y"].map((p, i) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(i)}
              className={cn(
                "px-1.5 py-1 rounded-md text-[14px] transition-colors",
                i === period
                  ? "bg-card text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[28px] font-bold tabular-nums text-foreground leading-none tracking-tight mb-5">
        {current.total}
      </p>
      <div className="space-y-3">
        {current.spenders.map((s) => {
          const pct = (s.cost / maxCost) * 100;
          return (
            <div key={s.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[14px] text-muted-foreground truncate">
                  {s.name}
                </span>
                <span className="text-[14px] tabular-nums text-muted-foreground ml-2 shrink-0">
                  ${s.cost.toFixed(2)}
                </span>
              </div>
              <div
                className="h-3 rounded-full bg-accent"
                style={{ width: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Shared compute card data ─── */
type AgentKind = "coding-agent" | "experiment" | "knowledge-base";
const COMPUTE_DEMO_AGENTS = [
  {
    id: "a1",
    name: "brand-asset-generator",
    state: "running" as const,
    size: 2,
    kind: "coding-agent" as AgentKind,
  },
  {
    id: "a2",
    name: "color-palette-testing",
    state: "running" as const,
    size: 1,
    kind: "experiment" as AgentKind,
  },
  {
    id: "a3",
    name: "photo-retouching",
    state: "awake" as const,
    size: 1,
    kind: "coding-agent" as AgentKind,
  },
];
const COMPUTE_TOTAL = 8;

type ComputeCellState = "running" | "awake" | "available";
interface ComputeCell {
  state: ComputeCellState;
  agentId: string | null;
  agentName: string | null;
  agentSize: number;
  agentKind: AgentKind | null;
}

const KIND_LABELS: Record<AgentKind, string> = {
  "coding-agent": "Coding Agent",
  experiment: "Experiment",
  "knowledge-base": "Knowledge Base",
};

function useComputeCells() {
  const cells: ComputeCell[] = [];
  for (const a of COMPUTE_DEMO_AGENTS.filter((d) => d.state === "running")) {
    for (let i = 0; i < a.size; i++)
      cells.push({
        state: "running",
        agentId: a.id,
        agentName: a.name,
        agentSize: a.size,
        agentKind: a.kind,
      });
  }
  for (const a of COMPUTE_DEMO_AGENTS.filter((d) => d.state === "awake")) {
    for (let i = 0; i < a.size; i++)
      cells.push({
        state: "awake",
        agentId: a.id,
        agentName: a.name,
        agentSize: a.size,
        agentKind: a.kind,
      });
  }
  while (cells.length < COMPUTE_TOTAL) {
    cells.push({
      state: "available",
      agentId: null,
      agentName: null,
      agentSize: 0,
      agentKind: null,
    });
  }
  const inUse = cells.filter((c) => c.state !== "available").length;
  const free = COMPUTE_TOTAL - inUse;
  const runningCpu = COMPUTE_DEMO_AGENTS.filter(
    (a) => a.state === "running",
  ).reduce((s, a) => s + a.size, 0);
  const awakeCpu = COMPUTE_DEMO_AGENTS.filter(
    (a) => a.state === "awake",
  ).reduce((s, a) => s + a.size, 0);
  const runningCount = COMPUTE_DEMO_AGENTS.filter(
    (a) => a.state === "running",
  ).length;
  const awakeCount = COMPUTE_DEMO_AGENTS.filter(
    (a) => a.state === "awake",
  ).length;
  return { cells, inUse, free, runningCpu, awakeCpu, runningCount, awakeCount };
}

export function ComputePreview() {
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const [hoveredState, setHoveredState] = useState<ComputeCellState | null>(
    null,
  );
  const { cells, inUse, free, runningCpu, awakeCpu, runningCount, awakeCount } =
    useComputeCells();

  const isHighlighted = (cell: ComputeCell) => {
    if (hoveredAgent) {
      if (cell.agentId) return cell.agentId === hoveredAgent;
      return hoveredAgent === "__available" && cell.state === "available";
    }
    if (hoveredState) return cell.state === hoveredState;
    return false;
  };
  const isDimmed = (cell: ComputeCell) =>
    !hoveredAgent && !hoveredState ? false : !isHighlighted(cell);
  const ariaLabelFor = (cell: ComputeCell) => {
    if (cell.state === "available") return "Available";
    return `${cell.agentName} — ${cell.agentKind ? KIND_LABELS[cell.agentKind] : "Agent"}, ${cell.agentSize} CPU · ${cell.agentSize} Gi`;
  };
  const tooltipFor = (cell: ComputeCell) => {
    if (cell.state === "available") return "Available";
    return (
      <div className="flex flex-col gap-0.5 py-0.5">
        <span className="text-[13px] font-medium text-popover-foreground">
          {cell.agentName}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {cell.agentKind ? KIND_LABELS[cell.agentKind] : "Agent"} ·{" "}
          {cell.agentSize} CPU · {cell.agentSize} Gi
        </span>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 flex flex-col">
      <div className="flex items-center justify-between mb-1 min-h-[32px]">
        <p className="text-[14px] text-muted-foreground">Compute resources</p>
        <Tooltip
          content={
            <div className="flex flex-col gap-1 py-0.5">
              <span className="text-[13px] font-medium text-popover-foreground">
                Need more compute?
              </span>
              <span className="text-[13px] text-muted-foreground">
                Request in{" "}
                <a
                  href="https://slack.com/app_redirect?channel=DAMBUDGET"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-500 hover:underline"
                >
                  #DAMBUDGET
                </a>{" "}
                on Slack
              </span>
            </div>
          }
          side="bottom"
        >
          <span className="text-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-default">
            Need more?
          </span>
        </Tooltip>
      </div>
      <p className="text-[28px] font-bold tabular-nums text-foreground leading-none tracking-tight mb-1">
        {inUse}/{COMPUTE_TOTAL}
      </p>
      <p className="text-[14px] text-muted-foreground mb-5">CPU · Gi</p>

      <div
        className="flex gap-0.5 mb-5 [&>span]:flex-1"
        role="group"
        aria-label="CPU usage meter"
      >
        {cells.map((cell, i) => (
          <Tooltip key={i} content={tooltipFor(cell)} side="bottom">
            <button
              type="button"
              className={cn(
                "h-3 w-full transition-all duration-150 outline-none",
                i === 0 && "rounded-l-full",
                i === cells.length - 1 && "rounded-r-full",
                cell.state === "running" && "bg-success",
                cell.state === "awake" && "bg-accent",
                cell.state === "available" &&
                  "border border-muted-foreground/25 bg-background",
                isHighlighted(cell) && "brightness-110 h-4 -my-0.5",
                isDimmed(cell) && "opacity-20",
                "focus-visible:brightness-110 focus-visible:h-4 focus-visible:-my-0.5",
              )}
              aria-label={ariaLabelFor(cell)}
              onMouseEnter={() =>
                cell.agentId
                  ? setHoveredAgent(cell.agentId)
                  : setHoveredAgent("__available")
              }
              onMouseLeave={() => setHoveredAgent(null)}
              onFocus={() =>
                cell.agentId
                  ? setHoveredAgent(cell.agentId)
                  : setHoveredAgent("__available")
              }
              onBlur={() => setHoveredAgent(null)}
            />
          </Tooltip>
        ))}
      </div>

      <div className="space-y-2 flex-1">
        {runningCount > 0 && (
          <button
            type="button"
            className={cn(
              "flex items-center justify-between w-full text-left transition-opacity duration-150 rounded px-1 -mx-1 outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
              hoveredState && hoveredState !== "running" && "opacity-30",
            )}
            onMouseEnter={() => setHoveredState("running")}
            onMouseLeave={() => setHoveredState(null)}
            onFocus={() => setHoveredState("running")}
            onBlur={() => setHoveredState(null)}
          >
            <span className="flex items-center gap-2 text-[14px] text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full bg-success inline-block shrink-0" />
              Running
            </span>
            <span className="text-[14px] tabular-nums text-muted-foreground">
              {runningCount} {runningCount === 1 ? "agent" : "agents"} ·{" "}
              {runningCpu} CPU · {runningCpu} Gi
            </span>
          </button>
        )}
        {awakeCount > 0 && (
          <button
            type="button"
            className={cn(
              "flex items-center justify-between w-full text-left transition-opacity duration-150 rounded px-1 -mx-1 outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
              hoveredState && hoveredState !== "awake" && "opacity-30",
            )}
            onMouseEnter={() => setHoveredState("awake")}
            onMouseLeave={() => setHoveredState(null)}
            onFocus={() => setHoveredState("awake")}
            onBlur={() => setHoveredState(null)}
          >
            <span className="flex items-center gap-2 text-[14px] text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full bg-accent inline-block shrink-0" />
              Awake
            </span>
            <span className="text-[14px] tabular-nums text-muted-foreground">
              {awakeCount} {awakeCount === 1 ? "agent" : "agents"} · {awakeCpu}{" "}
              CPU · {awakeCpu} Gi
            </span>
          </button>
        )}
        <button
          type="button"
          className={cn(
            "flex items-center justify-between w-full text-left transition-opacity duration-150 rounded px-1 -mx-1 outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
            hoveredState && hoveredState !== "available" && "opacity-30",
          )}
          onMouseEnter={() => setHoveredState("available")}
          onMouseLeave={() => setHoveredState(null)}
          onFocus={() => setHoveredState("available")}
          onBlur={() => setHoveredState(null)}
        >
          <span className="flex items-center gap-2 text-[14px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full border border-muted-foreground/25 bg-background inline-block shrink-0" />
            Available
          </span>
          <span className="text-[14px] tabular-nums text-muted-foreground">
            {free} CPU · {free} Gi
          </span>
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ready for Review — Dismiss Card Variants
   5 design explorations for how "ready for review" cards handle dismiss.
   ═══════════════════════════════════════════════════════════════════════════ */

function ReadyCardVariants() {
  const [option, setOption] = useState(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[14px] text-muted-foreground font-medium">
          Option:
        </span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setOption(n)}
            className={cn(
              "w-7 h-7 rounded-md text-[14px] font-medium transition-colors",
              option === n
                ? "bg-accent text-white"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {n}
          </button>
        ))}
        <span className="text-[14px] text-muted-foreground ml-2">
          {option === 1 && "Swipe-to-dismiss row"}
          {option === 2 && "Checkbox mark-as-read"}
          {option === 3 && "Inline dismiss + open"}
          {option === 4 && "Card with bottom actions bar"}
          {option === 5 && "Compact row with trailing dismiss"}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground leading-relaxed max-w-prose">
        {option === 1 &&
          "Cards slide right to reveal a dismiss zone. The card itself is the primary action (opens the item). Dismiss is intentional — requires a deliberate swipe or click on the revealed zone."}
        {option === 2 &&
          "Each card has a leading checkbox. Checking it marks the item as read/dismissed with a brief strikethrough animation before removal. Supports batch dismiss via a header checkbox."}
        {option === 3 &&
          "Two equal-weight buttons at the card's right edge: 'Open' (primary) and a ghost 'Dismiss'. Both always visible, no hover state needed. Clear, explicit, no ambiguity."}
        {option === 4 &&
          "Card content above, a thin actions bar below with 'Open' and 'Dismiss' separated by a hairline. The bar is part of the card, keeping spacing tight between cards."}
        {option === 5 &&
          "Minimal single-line row: icon + title + agent + time on one line, trailing X to dismiss. The whole row (except X) is clickable to open. Dense, scannable."}
      </p>
      <div className="space-y-3">
        {option === 1 && <ReadyVariant1 />}
        {option === 2 && <ReadyVariant2 />}
        {option === 3 && <ReadyVariant3 />}
        {option === 4 && <ReadyVariant4 />}
        {option === 5 && <ReadyVariant5 />}
      </div>
    </div>
  );
}

function ReadyVariant1() {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [swiped, setSwiped] = useState<number | null>(null);

  const cards = [
    {
      title: "Refactor auth middleware",
      agent: "backend-refactor",
      time: "45m ago",
    },
    {
      title: "Spring campaign hero images",
      agent: "brand-asset-generator",
      time: "2h ago",
    },
    {
      title: "Daily brand audit",
      agent: "brand-asset-generator",
      time: "6h ago",
    },
  ];

  return (
    <div className="space-y-2">
      {cards.map((card, i) => {
        if (dismissed.has(i)) return null;
        const isOpen = swiped === i;
        return (
          <div key={i} className="relative overflow-hidden rounded-lg">
            <div
              className="absolute inset-y-0 left-0 w-[100px] flex items-center justify-center bg-muted"
              onClick={() => {
                setDismissed((s) => new Set([...s, i]));
                setSwiped(null);
              }}
            >
              <span className="text-[14px] font-medium text-muted-foreground">
                Dismiss
              </span>
            </div>
            <div
              className={cn(
                "relative bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer transition-transform duration-200",
                isOpen && "translate-x-[100px]",
              )}
              onClick={() => setSwiped(isOpen ? null : i)}
            >
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
                <Chat size={16} className="text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] text-foreground truncate">
                  {card.title}
                </h3>
                <p className="text-[14px] text-muted-foreground">
                  {card.agent} · {card.time}
                </p>
              </div>
              <ChevronRight
                size={16}
                className="text-muted-foreground shrink-0"
              />
            </div>
          </div>
        );
      })}
      {dismissed.size === cards.length && (
        <div className="flex items-center gap-2 py-3">
          <Checkmark size={16} className="text-success" />
          <span className="text-[14px] text-muted-foreground">
            All caught up
          </span>
        </div>
      )}
    </div>
  );
}

function ReadyVariant2() {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const cards = [
    {
      title: "Refactor auth middleware",
      agent: "backend-refactor",
      time: "45m ago",
    },
    {
      title: "Spring campaign hero images",
      agent: "brand-asset-generator",
      time: "2h ago",
    },
    {
      title: "Daily brand audit",
      agent: "brand-asset-generator",
      time: "6h ago",
    },
  ];

  const toggleCheck = (i: number) => {
    const next = new Set(checked);
    if (next.has(i)) {
      next.delete(i);
    } else {
      next.add(i);
      setTimeout(() => {
        setDismissed((s) => new Set([...s, i]));
        setChecked((s) => {
          const n = new Set(s);
          n.delete(i);
          return n;
        });
      }, 600);
    }
    setChecked(next);
  };

  const allChecked = cards.every((_, i) => checked.has(i) || dismissed.has(i));

  return (
    <div className="space-y-0 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/40">
        <button
          type="button"
          onClick={() => {
            if (!allChecked) {
              cards.forEach((_, i) => {
                if (!dismissed.has(i)) toggleCheck(i);
              });
            }
          }}
          className={cn(
            "w-4 h-4 rounded border flex items-center justify-center transition-colors",
            allChecked
              ? "bg-accent border-accent"
              : "border-muted-foreground/40 hover:border-foreground",
          )}
        >
          {allChecked && <Checkmark size={16} className="text-white" />}
        </button>
        <span className="text-[14px] text-muted-foreground">
          Mark all as read
        </span>
      </div>
      {cards.map((card, i) => {
        if (dismissed.has(i)) return null;
        const isChecked = checked.has(i);
        return (
          <div
            key={i}
            className={cn(
              "flex items-center gap-3 px-4 py-3 border-b last:border-b-0 border-border transition-all duration-300",
              isChecked && "opacity-40",
            )}
          >
            <button
              type="button"
              onClick={() => toggleCheck(i)}
              className={cn(
                "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                isChecked
                  ? "bg-accent border-accent"
                  : "border-muted-foreground/40 hover:border-foreground",
              )}
            >
              {isChecked && <Checkmark size={16} className="text-white" />}
            </button>
            <div className="flex size-[34px] shrink-0 items-center justify-center rounded-lg bg-muted">
              <Chat size={16} className="text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <h3
                className={cn(
                  "text-[15px] text-foreground truncate",
                  isChecked && "line-through",
                )}
              >
                {card.title}
              </h3>
              <p className="text-[14px] text-muted-foreground">
                {card.agent} · {card.time}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={isChecked}>
              Open
            </Button>
          </div>
        );
      })}
      {dismissed.size === cards.length && (
        <div className="flex items-center gap-2 px-4 py-3">
          <Checkmark size={16} className="text-success" />
          <span className="text-[14px] text-muted-foreground">
            All caught up
          </span>
        </div>
      )}
    </div>
  );
}

function ReadyVariant3() {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const cards = [
    {
      title: "Refactor auth middleware",
      agent: "backend-refactor",
      time: "45m ago",
    },
    {
      title: "Spring campaign hero images",
      agent: "brand-asset-generator",
      time: "2h ago",
    },
    {
      title: "Daily brand audit",
      agent: "brand-asset-generator",
      time: "6h ago",
    },
  ];

  return (
    <div className="space-y-3">
      {cards.map((card, i) => {
        if (dismissed.has(i)) return null;
        return (
          <Card
            key={i}
            className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4"
          >
            <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
              <Chat size={16} className="text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[16px] text-foreground">
                {card.title}
              </h3>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {card.agent} · {card.time}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm">Open</Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setDismissed((s) => new Set([...s, i]))}
              >
                Dismiss
              </Button>
            </div>
          </Card>
        );
      })}
      {dismissed.size === cards.length && (
        <div className="flex items-center gap-2 py-3">
          <Checkmark size={16} className="text-success" />
          <span className="text-[14px] text-muted-foreground">
            All caught up
          </span>
        </div>
      )}
    </div>
  );
}

function ReadyVariant4() {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const cards = [
    {
      title: "Refactor auth middleware",
      agent: "backend-refactor",
      time: "45m ago",
    },
    {
      title: "Spring campaign hero images",
      agent: "brand-asset-generator",
      time: "2h ago",
    },
    {
      title: "Daily brand audit",
      agent: "brand-asset-generator",
      time: "6h ago",
    },
  ];

  return (
    <div className="space-y-3">
      {cards.map((card, i) => {
        if (dismissed.has(i)) return null;
        return (
          <div
            key={i}
            className="rounded-lg border border-border overflow-hidden"
          >
            <div className="flex items-start gap-3 p-4 bg-card">
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
                <Chat size={16} className="text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[16px] text-foreground">
                  {card.title}
                </h3>
                <p className="mt-1 text-[14px] text-muted-foreground">
                  {card.agent} · {card.time}
                </p>
              </div>
            </div>
            <div className="flex items-center border-t border-border bg-muted/30 divide-x divide-border">
              <button
                type="button"
                className="flex-1 px-4 py-2 text-[14px] font-medium text-foreground hover:bg-muted/60 transition-colors"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => setDismissed((s) => new Set([...s, i]))}
                className="flex-1 px-4 py-2 text-[14px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
      {dismissed.size === cards.length && (
        <div className="flex items-center gap-2 py-3">
          <Checkmark size={16} className="text-success" />
          <span className="text-[14px] text-muted-foreground">
            All caught up
          </span>
        </div>
      )}
    </div>
  );
}

function ReadyVariant5() {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const cards = [
    {
      title: "Refactor auth middleware",
      agent: "backend-refactor",
      time: "45m ago",
      icon: Chat,
    },
    {
      title: "Spring campaign hero images",
      agent: "brand-asset-generator",
      time: "2h ago",
      icon: Folders,
    },
    {
      title: "Daily brand audit",
      agent: "brand-asset-generator",
      time: "6h ago",
      icon: Time,
    },
  ];

  return (
    <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
      {cards.map((card, i) => {
        if (dismissed.has(i)) return null;
        const Icon = card.icon;
        return (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group"
          >
            <Icon size={16} className="text-muted-foreground shrink-0" />
            <span className="text-[15px] text-foreground truncate min-w-0 flex-1 cursor-pointer">
              {card.title}
            </span>
            <span className="text-[14px] text-muted-foreground shrink-0 hidden sm:inline">
              {card.agent}
            </span>
            <span className="text-[14px] text-muted-foreground shrink-0 tabular-nums">
              {card.time}
            </span>
            <button
              type="button"
              onClick={() => setDismissed((s) => new Set([...s, i]))}
              className="shrink-0 p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
              title="Dismiss"
            >
              <Close size={16} />
            </button>
          </div>
        );
      })}
      {dismissed.size === cards.length && (
        <div className="flex items-center gap-2 px-4 py-3">
          <Checkmark size={16} className="text-success" />
          <span className="text-[14px] text-muted-foreground">
            All caught up
          </span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCHEDULE OVERVIEW WIDGET (sidebar — read-only, top 5 + "See all" modal)
   ═══════════════════════════════════════════════════════════════════════════ */

const SCHEDULE_OVERVIEW_DATA = [
  {
    name: "Daily brand audit",
    cadence: "Weekdays 9:00 AM",
    nextRun: "3h",
    enabled: true,
    agent: "brand-asset-generator",
  },
  {
    name: "Nightly test suite",
    cadence: "Daily 2:00 AM",
    nextRun: "14h",
    enabled: true,
    agent: "backend-refactor",
  },
  {
    name: "Weekly report generation",
    cadence: "Mon 8:00 AM",
    nextRun: "2d",
    enabled: true,
    agent: "reporting-agent",
  },
  {
    name: "Dependency vulnerability scan",
    cadence: "Every 6h",
    nextRun: "4h",
    enabled: false,
    agent: "security-scanner",
  },
  {
    name: "Performance benchmark",
    cadence: "Daily 3:00 AM",
    nextRun: "15h",
    enabled: false,
    agent: "perf-monitor",
  },
  {
    name: "Data pipeline sync",
    cadence: "Every 30m",
    nextRun: "12m",
    enabled: true,
    agent: "data-pipeline",
  },
  {
    name: "Slack digest summary",
    cadence: "Weekdays 5:00 PM",
    nextRun: "7h",
    enabled: true,
    agent: "reporting-agent",
  },
  {
    name: "Model fine-tune checkpoint",
    cadence: "Every 12h",
    nextRun: "8h",
    enabled: false,
    agent: "ml-trainer",
  },
  {
    name: "Stale PR cleanup",
    cadence: "Fri 4:00 PM",
    nextRun: "4d",
    enabled: true,
    agent: "backend-refactor",
  },
  {
    name: "Cost anomaly detector",
    cadence: "Every 1h",
    nextRun: "45m",
    enabled: true,
    agent: "cost-monitor",
  },
];

function parseNextRun(t: string): number {
  const num = parseInt(t);
  if (t.includes("m")) return num;
  if (t.includes("h")) return num * 60;
  if (t.includes("d")) return num * 60 * 24;
  return num;
}

const SORTED_SCHEDULES = [...SCHEDULE_OVERVIEW_DATA].sort(
  (a, b) => parseNextRun(a.nextRun) - parseNextRun(b.nextRun),
);

const SCHEDULE_AGENTS = [
  {
    id: "1",
    name: "brand-asset-generator",
    kind: undefined as string | undefined,
  },
  { id: "2", name: "backend-refactor", kind: undefined as string | undefined },
  { id: "3", name: "security-scanner", kind: undefined as string | undefined },
  { id: "4", name: "data-pipeline", kind: undefined as string | undefined },
  { id: "5", name: "perf-monitor", kind: undefined as string | undefined },
  { id: "6", name: "reporting-agent", kind: undefined as string | undefined },
];

function scheduleKindLabel(kind: string | undefined) {
  if (kind === "experiment") return "Experiment";
  return "Coding Agent";
}

export function ScheduleOverviewWidget() {
  const showConfirm = useStore((s) => s.showConfirm);
  const [listOpen, setListOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<
    (typeof SORTED_SCHEDULES)[number] | null
  >(null);
  const [editEnabled, setEditEnabled] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState(SCHEDULE_AGENTS[0]!.id);
  const [toggleOverrides, setToggleOverrides] = useState<Map<number, boolean>>(new Map());
  const top5 = SORTED_SCHEDULES.slice(0, 5);

  const isEnabled = (idx: number) => toggleOverrides.get(idx) ?? SORTED_SCHEDULES[idx]!.enabled;

  const onDelete = async () => {
    if (
      await showConfirm(
        "Are you sure you want to delete this schedule?",
        `Delete ${editingSchedule?.name}?`,
        { kind: "destructive", confirmLabel: "Delete Schedule" },
      )
    )
      setFormOpen(false);
  };

  const openEdit = (s: (typeof SORTED_SCHEDULES)[number]) => {
    setEditingSchedule(s);
    setEditEnabled(s.enabled);
    const agent = SCHEDULE_AGENTS.find((a) => a.name === s.agent);
    if (agent) setSelectedAgent(agent.id);
    setFormOpen(true);
  };

  const openNew = () => {
    setEditingSchedule(null);
    setEditEnabled(true);
    setSelectedAgent("");
    setFormOpen(true);
  };

  const agentPicker = (
    <FormField label="Agent" disableInset>
      <select
        value={selectedAgent}
        onChange={(e) => setSelectedAgent(e.target.value)}
        className={cn(
          "h-[40px] w-full rounded-md border border-border bg-background px-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-ring",
          selectedAgent ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <option value="" disabled>
          Choose your agent
        </option>
        {SCHEDULE_AGENTS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} — {scheduleKindLabel(a.kind)}
          </option>
        ))}
      </select>
    </FormField>
  );

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[14px] text-muted-foreground">
            Schedules
            <span className="ml-1.5">({SORTED_SCHEDULES.length})</span>
          </p>
          <Button
            variant="outline"
            size="xs"
            className="text-[14px]"
            onClick={openNew}
          >
            <Add size={16} /> New
          </Button>
        </div>

        <div className="space-y-0.5">
          {top5.map((s, i) => {
            const globalIdx = SORTED_SCHEDULES.indexOf(s);
            const enabled = isEnabled(globalIdx);
            return (
              <div
                key={i}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50",
                  !enabled && "opacity-50",
                )}
              >
                <button
                  type="button"
                  onClick={() => openEdit(s)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-[14px] text-foreground truncate">{s.name}</p>
                  <p className="text-[14px] text-muted-foreground truncate">
                    {s.cadence}
                  </p>
                </button>
                <Switch
                  checked={enabled}
                  onCheckedChange={() => {
                    setToggleOverrides((prev) => new Map([...prev, [globalIdx, !enabled]]));
                  }}
                  className="shrink-0"
                />
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setListOpen(true)}
          className="text-[14px] text-muted-foreground hover:text-foreground transition-colors mt-3 px-2"
        >
          See all
        </button>
      </div>

      {/* "See all" list modal */}
      {listOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setListOpen(false)}
          />
          <div className="relative z-10 w-full max-w-[520px] max-h-[70vh] rounded-2xl border border-border bg-card shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="text-[16px] font-semibold text-foreground">
                All schedules
                <span className="text-[14px] font-normal text-muted-foreground ml-1.5">
                  ({SORTED_SCHEDULES.length})
                </span>
              </h2>
              <button
                type="button"
                onClick={() => setListOpen(false)}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Close size={16} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-2 py-2">
              {SORTED_SCHEDULES.map((s, i) => {
                const enabled = isEnabled(i);
                return (
                  <div
                    key={i}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-muted/50",
                      !enabled && "opacity-50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setListOpen(false);
                        openEdit(s);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="text-[14px] text-foreground truncate">
                        {s.name}
                      </p>
                      <p className="text-[14px] text-muted-foreground truncate">
                        {s.cadence}
                      </p>
                    </button>
                    <Switch
                      checked={enabled}
                      onCheckedChange={() => {
                        setToggleOverrides((prev) => new Map([...prev, [i, !enabled]]));
                      }}
                      className="shrink-0"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Schedule form modal — same as home page feed, with toggle + delete for editing */}
      {formOpen && (
        <ScheduleFormModal
          agentId={selectedAgent}
          existing={
            editingSchedule
              ? ({
                  id: "sched_demo_1",
                  name: editingSchedule.name,
                  agentId: selectedAgent,
                  type: "rrule",
                  cron: null,
                  rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                  timezone: "America/New_York",
                  quietHours: [],
                  task: "Run the scheduled task as configured.",
                  enabled: editingSchedule.enabled,
                  sessionMode: "fresh",
                  createdBy: "user",
                  status: null,
                } satisfies Schedule)
              : undefined
          }
          onClose={() => setFormOpen(false)}
          onSaved={() => setFormOpen(false)}
          title={editingSchedule ? "Edit schedule" : undefined}
          submitLabel={editingSchedule ? "Save" : undefined}
          headerSlot={agentPicker}
          footerLeftSlot={
            editingSchedule ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => void onDelete()}
              >
                Delete
              </Button>
            ) : undefined
          }
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCHEDULED SECTION VARIANTS (legacy — toggle-based designs, kept for reference)
   ═══════════════════════════════════════════════════════════════════════════ */

const SCHED_DATA = [
  {
    name: "Daily brand audit",
    cadence: "Weekdays 9:00 AM",
    nextRun: "3h",
    lastResult: "success",
    enabled: true,
    agent: "brand-asset-generator",
  },
  {
    name: "Nightly test suite",
    cadence: "Daily 2:00 AM",
    nextRun: "14h",
    lastResult: "failed",
    enabled: true,
    agent: "backend-refactor",
  },
  {
    name: "Weekly report generation",
    cadence: "Mon 8:00 AM",
    nextRun: "2d",
    lastResult: "success",
    enabled: true,
    agent: "reporting-agent",
  },
  {
    name: "Dependency vulnerability scan",
    cadence: "Every 6h",
    nextRun: "4h",
    lastResult: "success",
    enabled: true,
    agent: "security-scanner",
  },
  {
    name: "Performance benchmark",
    cadence: "Daily 3:00 AM",
    nextRun: "15h",
    lastResult: "success",
    enabled: true,
    agent: "perf-monitor",
  },
  {
    name: "Data pipeline sync",
    cadence: "Every 30m",
    nextRun: "12m",
    lastResult: "success",
    enabled: true,
    agent: "data-pipeline",
  },
  {
    name: "Slack digest summary",
    cadence: "Weekdays 5:00 PM",
    nextRun: "7h",
    lastResult: "success",
    enabled: true,
    agent: "reporting-agent",
  },
  {
    name: "Model fine-tune checkpoint",
    cadence: "Every 12h",
    nextRun: "8h",
    lastResult: "success",
    enabled: false,
    agent: "ml-trainer",
  },
  {
    name: "Stale PR cleanup",
    cadence: "Fri 4:00 PM",
    nextRun: "4d",
    lastResult: "success",
    enabled: true,
    agent: "backend-refactor",
  },
  {
    name: "Cost anomaly detector",
    cadence: "Every 1h",
    nextRun: "45m",
    lastResult: "failed",
    enabled: true,
    agent: "cost-monitor",
  },
];

function ScheduledSectionVariants() {
  const [option, setOption] = useState(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[14px] text-muted-foreground font-medium">
          Option:
        </span>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setOption(n)}
            className={cn(
              "w-7 h-7 rounded-md text-[14px] font-medium transition-colors",
              option === n
                ? "bg-accent text-white"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {n}
          </button>
        ))}
        <span className="text-[14px] text-muted-foreground ml-2">
          {option === 1 && "Dense data table with status rail"}
          {option === 2 && "Timeline countdown strip"}
          {option === 3 && "Bento grid with status glow"}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground leading-relaxed max-w-prose">
        {option === 1 &&
          "A compact table-like layout. Each row is a single dense line — name, cadence, countdown, status dot, toggle. Maximizes information density. Failed schedules get a red left-border accent. Disabled ones are dimmed."}
        {option === 2 &&
          "A horizontal scrolling strip of countdown tiles sorted by next-run time. Each tile shows the countdown prominently with the name below. Status is encoded as the tile's top-edge color. Toggle lives in an expanded state on click."}
        {option === 3 &&
          "A responsive bento grid of cards at varying sizes. Failed/attention items get a larger tile with glow accent. Each tile has the schedule name, a circular countdown indicator, cadence, and agent. Toggle is always visible."}
      </p>
      <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold text-foreground">
            Scheduled{" "}
            <span className="text-[14px] font-normal text-muted-foreground">
              ({SCHED_DATA.length})
            </span>
          </h2>
        </div>
        {option === 1 && <ScheduledVariant1 />}
        {option === 2 && <ScheduledVariant2 />}
        {option === 3 && <ScheduledVariant3 />}
      </div>
    </div>
  );
}

function ScheduledVariant1() {
  const [toggles, setToggles] = useState<Record<number, boolean>>({});

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="grid grid-cols-[1fr_120px_80px_60px_44px] gap-2 px-3 py-2 bg-muted/50 border-b border-border">
        <span className="text-[14px] font-medium text-muted-foreground">
          Name
        </span>
        <span className="text-[14px] font-medium text-muted-foreground">
          Cadence
        </span>
        <span className="text-[14px] font-medium text-muted-foreground text-right">
          Next run
        </span>
        <span className="text-[14px] font-medium text-muted-foreground text-center">
          Status
        </span>
        <span />
      </div>
      {SCHED_DATA.map((s, i) => {
        const enabled = toggles[i] ?? s.enabled;
        const failed = s.lastResult === "failed";
        return (
          <div
            key={i}
            className={cn(
              "grid grid-cols-[1fr_120px_80px_60px_44px] gap-2 items-center px-3 py-2.5 border-b border-border last:border-b-0 transition-opacity",
              !enabled && "opacity-40",
              failed && "border-l-2 border-l-destructive",
            )}
          >
            <div className="min-w-0">
              <span className="text-[14px] text-foreground truncate block">
                {s.name}
              </span>
              <span className="text-[14px] text-muted-foreground truncate block">
                {s.agent}
              </span>
            </div>
            <span className="text-[14px] text-muted-foreground tabular-nums truncate">
              {s.cadence}
            </span>
            <span className="text-[14px] text-foreground tabular-nums text-right font-medium">
              {s.nextRun}
            </span>
            <div className="flex justify-center">
              <span
                className={cn(
                  "w-2.5 h-2.5 rounded-full",
                  failed
                    ? "bg-destructive"
                    : enabled
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/30",
                )}
              />
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={() =>
                setToggles((p) => ({ ...p, [i]: !enabled }))
              }
              label={s.name}
            />
          </div>
        );
      })}
    </div>
  );
}

function ScheduledVariant2() {
  const sorted = [...SCHED_DATA].sort((a, b) => {
    const parseTime = (t: string) => {
      const num = parseInt(t);
      if (t.includes("m")) return num;
      if (t.includes("h")) return num * 60;
      if (t.includes("d")) return num * 60 * 24;
      return num;
    };
    return parseTime(a.nextRun) - parseTime(b.nextRun);
  });

  const [expanded, setExpanded] = useState<number | null>(null);
  const [toggles, setToggles] = useState<Record<number, boolean>>({});

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {sorted.map((s, i) => {
          const enabled = toggles[i] ?? s.enabled;
          const failed = s.lastResult === "failed";
          const isExpanded = expanded === i;

          return (
            <button
              key={i}
              type="button"
              onClick={() => setExpanded(isExpanded ? null : i)}
              className={cn(
                "relative flex-shrink-0 w-[130px] rounded-xl border bg-card p-3 text-left transition-all",
                isExpanded
                  ? "ring-2 ring-accent/50 border-accent"
                  : "border-border hover:border-foreground/20",
                !enabled && "opacity-40",
              )}
            >
              <div
                className={cn(
                  "absolute top-0 left-3 right-3 h-[3px] rounded-b-full",
                  failed
                    ? "bg-destructive"
                    : enabled
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/20",
                )}
              />
              <p className="text-[20px] font-bold text-foreground tabular-nums mt-1">
                {s.nextRun}
              </p>
              <p className="text-[14px] text-foreground font-medium mt-1 truncate">
                {s.name}
              </p>
              <p className="text-[14px] text-muted-foreground truncate">
                {s.cadence}
              </p>
            </button>
          );
        })}
      </div>

      {expanded !== null && (
        <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
          <div>
            <p className="text-[14px] font-medium text-foreground">
              {sorted[expanded].name}
            </p>
            <p className="text-[14px] text-muted-foreground">
              {sorted[expanded].agent} · {sorted[expanded].cadence}
            </p>
            {sorted[expanded].lastResult === "failed" && (
              <p className="text-[14px] text-destructive mt-1">
                Last run failed
              </p>
            )}
          </div>
          <Switch
            checked={toggles[expanded] ?? sorted[expanded].enabled}
            onCheckedChange={() => {
              const cur = toggles[expanded] ?? sorted[expanded].enabled;
              setToggles((p) => ({ ...p, [expanded]: !cur }));
            }}
            label={sorted[expanded].name}
          />
        </div>
      )}
    </div>
  );
}

function ScheduledVariant3() {
  const [toggles, setToggles] = useState<Record<number, boolean>>({});

  const failedItems = SCHED_DATA.filter((s) => s.lastResult === "failed");
  const activeItems = SCHED_DATA.filter(
    (s) => s.lastResult !== "failed" && s.enabled,
  );
  const disabledItems = SCHED_DATA.filter((s) => !s.enabled);

  function CountdownRing({ time, failed }: { time: string; failed?: boolean }) {
    const num = parseInt(time);
    const unit = time.replace(/[0-9]/g, "");
    const maxMinutes = unit === "m" ? 60 : unit === "h" ? 24 * 60 : 7 * 24 * 60;
    const currentMinutes =
      unit === "m" ? num : unit === "h" ? num * 60 : num * 24 * 60;
    const progress = Math.max(0.05, 1 - currentMinutes / maxMinutes);
    const circumference = 2 * Math.PI * 18;
    const offset = circumference * (1 - progress);

    return (
      <div className="relative w-[48px] h-[48px] flex items-center justify-center">
        <svg width="48" height="48" className="absolute -rotate-90">
          <circle
            cx="24"
            cy="24"
            r="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-muted/50"
          />
          <circle
            cx="24"
            cy="24"
            r="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={failed ? "text-destructive" : "text-emerald-500"}
          />
        </svg>
        <span className="text-[14px] font-bold tabular-nums text-foreground">
          {time}
        </span>
      </div>
    );
  }

  function BentoTile({
    s,
    i,
    large,
  }: {
    s: (typeof SCHED_DATA)[number];
    i: number;
    large?: boolean;
  }) {
    const enabled = toggles[i] ?? s.enabled;
    const failed = s.lastResult === "failed";

    return (
      <div
        className={cn(
          "relative rounded-xl border bg-card p-4 transition-opacity",
          large ? "col-span-2 row-span-2" : "",
          failed &&
            "border-destructive/40 shadow-[0_0_20px_-4px] shadow-destructive/20",
          !enabled && "opacity-40",
          !failed && "border-border",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "font-semibold text-foreground truncate",
                large ? "text-[16px]" : "text-[14px]",
              )}
            >
              {s.name}
            </p>
            <p className="text-[14px] text-muted-foreground truncate mt-0.5">
              {s.agent}
            </p>
          </div>
          <CountdownRing time={s.nextRun} failed={failed} />
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[14px] text-muted-foreground">{s.cadence}</span>
          <Switch
            checked={enabled}
            onCheckedChange={() => setToggles((p) => ({ ...p, [i]: !enabled }))}
            label={s.name}
          />
        </div>
        {failed && (
          <div className="mt-2 rounded-md bg-destructive/10 px-2 py-1">
            <span className="text-[14px] text-destructive font-medium">
              Last run failed
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 auto-rows-min">
      {failedItems.map((s, i) => (
        <BentoTile key={`f-${i}`} s={s} i={SCHED_DATA.indexOf(s)} large />
      ))}
      {activeItems.map((s, i) => (
        <BentoTile key={`a-${i}`} s={s} i={SCHED_DATA.indexOf(s)} />
      ))}
      {disabledItems.map((s, i) => (
        <BentoTile key={`d-${i}`} s={s} i={SCHED_DATA.indexOf(s)} />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   BENTO HOME PAGE LAYOUT VARIANTS
   ═══════════════════════════════════════════════════════════════════════════ */

function BentoHomeVariants() {
  const [option, setOption] = useState(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-[14px] text-muted-foreground font-medium">
          Option:
        </span>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setOption(n)}
            className={cn(
              "w-7 h-7 rounded-md text-[14px] font-medium transition-colors",
              option === n
                ? "bg-accent text-white"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {n}
          </button>
        ))}
        <span className="text-[14px] text-muted-foreground ml-2">
          {option === 1 && "Asymmetric masonry — hero left, stack right"}
          {option === 2 && "Full-width rows with inset bento cells"}
          {option === 3 && "Dashboard grid — mixed sizes, no section wrappers"}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground leading-relaxed max-w-prose">
        {option === 1 &&
          "The biggest priority (needs attention or ready for review) takes a tall left column. Right column stacks active + scheduled as compact cells. Spend/compute lives as a slim footer strip. Sections don't have their own border — they ARE the grid cells."}
        {option === 2 &&
          "Each section is a full-width row, but internally uses a bento sub-grid. Ready for review: 2 large + 3 small. Active: horizontal card strip. Scheduled: the countdown ring grid. Needs attention spans full width as an alert banner."}
        {option === 3 &&
          "No section wrappers at all. Every card is a direct grid child at varying spans. Needs-attention cards are 2-col-wide alert cells. Ready-for-review, active, scheduled all intermix in one unified grid sorted by priority. Section labels float as small overlaid chips."}
      </p>
      {option === 1 && <BentoHome1 />}
      {option === 2 && <BentoHome2 />}
      {option === 3 && <BentoHome3 />}
    </div>
  );
}

function BentoHome1() {
  return (
    <div className="rounded-2xl border border-border bg-card/50 p-4 space-y-4">
      {/* Header */}
      <h1 className="text-[24px] font-semibold tracking-[-0.65px] text-foreground">
        Home
      </h1>

      {/* Main bento: tall left + stacked right */}
      <div className="grid grid-cols-3 gap-3 auto-rows-min">
        {/* LEFT: Ready for review — spans 2 cols, tall */}
        <div className="col-span-2 row-span-3 rounded-xl border border-border bg-card p-5">
          <h2 className="text-[14px] font-semibold text-foreground mb-3">
            Ready for review
          </h2>
          <div className="space-y-2">
            {[
              {
                title: "Refactor auth middleware",
                agent: "backend-refactor",
                time: "45m ago",
              },
              {
                title: "Spring campaign hero images",
                agent: "brand-asset-generator",
                time: "2h ago",
              },
              {
                title: "Daily brand audit",
                agent: "brand-asset-generator",
                time: "6h ago",
              },
              {
                title: "Nightly performance report",
                agent: "reporting-agent",
                time: "8h ago",
              },
              {
                title: "Spring palette experiment",
                agent: "color-palette-testing",
                time: "10h ago",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-foreground truncate">
                    {item.title}
                  </p>
                  <p className="text-[14px] text-muted-foreground">
                    {item.agent}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[14px] text-muted-foreground tabular-nums">
                    {item.time}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[14px]"
                  >
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[14px] text-muted-foreground"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT TOP: Needs attention — compact alert */}
        <div className="col-span-1 rounded-xl border border-destructive/30 bg-gradient-to-br from-destructive/5 to-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-destructive" />
            <h2 className="text-[14px] font-semibold text-foreground">
              Needs attention
            </h2>
          </div>
          <p className="text-[14px] text-foreground font-medium">
            GET api.figma.com
          </p>
          <p className="text-[14px] text-muted-foreground">
            brand-asset-generator · 3m ago
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[14px] flex-1"
            >
              Allow
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[14px] flex-1 text-muted-foreground"
            >
              Deny
            </Button>
          </div>
        </div>

        {/* RIGHT MID: Active — compact */}
        <div className="col-span-1 rounded-xl border border-border bg-card p-4">
          <h2 className="text-[14px] font-semibold text-foreground mb-2">
            Active
          </h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[14px] text-foreground truncate">
                Implement dark mode toggle
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[14px] text-foreground truncate">
                Spring palette experiment
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT BOTTOM: Spend */}
        <div className="col-span-1 rounded-xl border border-border bg-card p-4">
          <h2 className="text-[14px] font-semibold text-foreground mb-1">
            Spend
          </h2>
          <p className="text-[24px] font-bold text-foreground tabular-nums">
            $31.57
          </p>
          <p className="text-[14px] text-muted-foreground">this month</p>
        </div>
      </div>

      {/* Bottom strip: Scheduled bento */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-[14px] font-semibold text-foreground mb-3">
          Scheduled
        </h2>
        <div className="grid grid-cols-5 gap-2">
          {SCHED_DATA.slice(0, 5).map((s, i) => {
            const failed = s.lastResult === "failed";
            return (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-3 text-center",
                  failed
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border bg-muted/30",
                )}
              >
                <p className="text-[18px] font-bold tabular-nums text-foreground">
                  {s.nextRun}
                </p>
                <p className="text-[14px] text-muted-foreground truncate mt-0.5">
                  {s.name}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BentoHome2() {
  return (
    <div className="rounded-2xl border border-border bg-card/50 p-4 space-y-3">
      {/* Header */}
      <h1 className="text-[24px] font-semibold tracking-[-0.65px] text-foreground">
        Home
      </h1>

      {/* Row 1: Alert banner — full width, no card wrapper */}
      <div className="flex items-center gap-4 rounded-xl border border-destructive/30 bg-gradient-to-r from-destructive/8 to-transparent px-5 py-3">
        <span className="w-2.5 h-2.5 rounded-full bg-destructive shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">
            1 item needs attention
          </p>
          <p className="text-[14px] text-muted-foreground">
            brand-asset-generator wants to access api.figma.com
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-[14px]">
            Allow once
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[14px]">
            Always allow
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[14px] text-muted-foreground"
          >
            Deny
          </Button>
        </div>
      </div>

      {/* Row 2: Ready for review — bento sub-grid (2 large + 3 small) */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-foreground">
            Ready for review{" "}
            <span className="font-normal text-muted-foreground">(5)</span>
          </h2>
          <button
            type="button"
            className="text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss all
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {/* 2 large cards */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-[14px] font-semibold text-foreground">
              Refactor auth middleware
            </p>
            <p className="text-[14px] text-muted-foreground mt-0.5">
              backend-refactor · 45m ago
            </p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="h-7 text-[14px]">
                Open
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[14px] text-muted-foreground"
              >
                Dismiss
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-[14px] font-semibold text-foreground">
              Spring campaign hero images
            </p>
            <p className="text-[14px] text-muted-foreground mt-0.5">
              brand-asset-generator · 2h ago
            </p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="h-7 text-[14px]">
                Open
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[14px] text-muted-foreground"
              >
                Dismiss
              </Button>
            </div>
          </div>
          {/* 3 small cards in a row below */}
          <div className="col-span-2 grid grid-cols-3 gap-2">
            {[
              "Daily brand audit",
              "Nightly performance report",
              "Spring palette experiment",
            ].map((t, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 flex items-center justify-between"
              >
                <p className="text-[14px] text-foreground truncate">{t}</p>
                <button
                  type="button"
                  className="text-[14px] text-muted-foreground hover:text-foreground shrink-0 ml-2"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Active + Spend side by side */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-[14px] font-semibold text-foreground mb-3">
            Active
          </h2>
          <div className="flex gap-3">
            <div className="flex-1 rounded-lg bg-muted/40 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[14px] font-medium text-foreground">
                  Implement dark mode toggle
                </span>
              </div>
              <p className="text-[14px] text-muted-foreground">
                frontend-agent · 12m
              </p>
            </div>
            <div className="flex-1 rounded-lg bg-muted/40 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[14px] font-medium text-foreground">
                  Spring palette — warm vs cool
                </span>
              </div>
              <p className="text-[14px] text-muted-foreground">
                color-palette-testing · 45m
              </p>
            </div>
          </div>
        </div>
        <div className="col-span-1 rounded-xl border border-border bg-card p-4 flex flex-col justify-between">
          <h2 className="text-[14px] font-semibold text-foreground">
            This month
          </h2>
          <p className="text-[28px] font-bold text-foreground tabular-nums">
            $31.57
          </p>
          <p className="text-[14px] text-muted-foreground">
            4 agents · 12 sessions
          </p>
        </div>
      </div>

      {/* Row 4: Scheduled — countdown ring grid */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-[14px] font-semibold text-foreground mb-3">
          Scheduled{" "}
          <span className="font-normal text-muted-foreground">(10)</span>
        </h2>
        <div className="grid grid-cols-5 gap-3">
          {SCHED_DATA.slice(0, 10).map((s, i) => {
            const failed = s.lastResult === "failed";
            const num = parseInt(s.nextRun);
            const unit = s.nextRun.replace(/[0-9]/g, "");
            const maxMinutes =
              unit === "m" ? 60 : unit === "h" ? 24 * 60 : 7 * 24 * 60;
            const currentMinutes =
              unit === "m" ? num : unit === "h" ? num * 60 : num * 24 * 60;
            const progress = Math.max(0.05, 1 - currentMinutes / maxMinutes);
            const circumference = 2 * Math.PI * 16;
            const offset = circumference * (1 - progress);
            return (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-3 flex flex-col items-center gap-1.5",
                  failed
                    ? "border-destructive/40 bg-destructive/5"
                    : !s.enabled
                      ? "border-border opacity-40"
                      : "border-border",
                )}
              >
                <div className="relative w-[40px] h-[40px] flex items-center justify-center">
                  <svg width="40" height="40" className="absolute -rotate-90">
                    <circle
                      cx="20"
                      cy="20"
                      r="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="text-muted/40"
                    />
                    <circle
                      cx="20"
                      cy="20"
                      r="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeDasharray={circumference}
                      strokeDashoffset={offset}
                      strokeLinecap="round"
                      className={
                        failed ? "text-destructive" : "text-emerald-500"
                      }
                    />
                  </svg>
                  <span className="text-[14px] font-bold tabular-nums text-foreground">
                    {s.nextRun}
                  </span>
                </div>
                <p className="text-[14px] text-foreground text-center truncate w-full">
                  {s.name}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BentoHome3() {
  const items = [
    {
      kind: "attention",
      span: "col-span-2",
      title: "GET api.figma.com",
      sub: "brand-asset-generator · 3m ago",
    },
    {
      kind: "ready",
      span: "col-span-1",
      title: "Refactor auth middleware",
      sub: "backend-refactor · 45m ago",
    },
    {
      kind: "ready",
      span: "col-span-1",
      title: "Spring campaign hero images",
      sub: "brand-asset-generator · 2h ago",
    },
    {
      kind: "active",
      span: "col-span-1",
      title: "Implement dark mode toggle",
      sub: "frontend-agent · running 12m",
    },
    {
      kind: "active",
      span: "col-span-1",
      title: "Spring palette experiment",
      sub: "color-palette-testing · running 45m",
    },
    {
      kind: "ready",
      span: "col-span-1",
      title: "Daily brand audit",
      sub: "brand-asset-generator · 6h ago",
    },
    { kind: "spend", span: "col-span-1", title: "$31.57", sub: "this month" },
    {
      kind: "ready",
      span: "col-span-1",
      title: "Nightly performance report",
      sub: "reporting-agent · 8h ago",
    },
    {
      kind: "ready",
      span: "col-span-1",
      title: "Spring palette — warm vs cool",
      sub: "color-palette-testing · 10h ago",
    },
    { kind: "schedule", span: "col-span-2", title: "Schedules", sub: "" },
  ];

  const kindStyles: Record<string, string> = {
    attention:
      "border-destructive/40 bg-gradient-to-br from-destructive/8 to-card",
    ready: "border-border bg-card hover:border-foreground/20",
    active:
      "border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-card",
    spend: "border-border bg-card",
    schedule: "border-border bg-card",
  };

  const kindLabels: Record<string, { text: string; color: string }> = {
    attention: { text: "Blocked", color: "bg-destructive text-white" },
    ready: { text: "Review", color: "bg-accent/10 text-accent" },
    active: { text: "Active", color: "bg-emerald-500/10 text-emerald-600" },
    spend: { text: "Spend", color: "bg-muted text-muted-foreground" },
    schedule: { text: "Scheduled", color: "bg-muted text-muted-foreground" },
  };

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-4 space-y-4">
      <h1 className="text-[24px] font-semibold tracking-[-0.65px] text-foreground">
        Home
      </h1>

      <div className="grid grid-cols-2 gap-2.5">
        {items.map((item, i) => {
          const label = kindLabels[item.kind];

          if (item.kind === "schedule") {
            return (
              <div
                key={i}
                className={cn(
                  "rounded-xl border p-4",
                  item.span,
                  kindStyles[item.kind],
                )}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[14px] font-medium",
                      label.color,
                    )}
                  >
                    {label.text}
                  </span>
                  <span className="text-[14px] text-muted-foreground">
                    10 schedules
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {SCHED_DATA.slice(0, 5).map((s, j) => {
                    const failed = s.lastResult === "failed";
                    return (
                      <div
                        key={j}
                        className={cn(
                          "rounded-lg p-2 text-center border",
                          failed
                            ? "border-destructive/30 bg-destructive/5"
                            : "border-border bg-muted/20",
                        )}
                      >
                        <p className="text-[16px] font-bold tabular-nums text-foreground">
                          {s.nextRun}
                        </p>
                        <p className="text-[14px] text-muted-foreground truncate">
                          {s.name}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[14px] text-muted-foreground mt-2">
                  +5 more schedules
                </p>
              </div>
            );
          }

          if (item.kind === "spend") {
            return (
              <div
                key={i}
                className={cn(
                  "rounded-xl border p-4 flex flex-col justify-center",
                  item.span,
                  kindStyles[item.kind],
                )}
              >
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[14px] font-medium self-start mb-2",
                    label.color,
                  )}
                >
                  {label.text}
                </span>
                <p className="text-[32px] font-bold text-foreground tabular-nums leading-none">
                  {item.title}
                </p>
                <p className="text-[14px] text-muted-foreground mt-1">
                  {item.sub}
                </p>
              </div>
            );
          }

          return (
            <div
              key={i}
              className={cn(
                "rounded-xl border p-4 transition-colors",
                item.span,
                kindStyles[item.kind],
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[14px] font-medium shrink-0",
                    label.color,
                  )}
                >
                  {label.text}
                </span>
                {item.kind === "active" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </div>
              <p className="text-[14px] font-semibold text-foreground mt-2 truncate">
                {item.title}
              </p>
              <p className="text-[14px] text-muted-foreground mt-0.5">
                {item.sub}
              </p>
              {item.kind === "attention" && (
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[14px]"
                  >
                    Allow once
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[14px]"
                  >
                    Always allow
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[14px] text-muted-foreground"
                  >
                    Deny
                  </Button>
                </div>
              )}
              {item.kind === "ready" && (
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[14px]"
                  >
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[14px] text-muted-foreground"
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Bento 1 — Ready for Review Card Variants
   All card types that appear in the Bento 1 feed, categorized by kind.
   ═══════════════════════════════════════════════════════════════════════════ */

function Bento1CardVariants() {
  return (
    <div className="space-y-8">
      {/* ─── Experiments ─── */}
      <div className="space-y-3">
        <p className="text-[14px] font-semibold text-foreground tracking-wide uppercase opacity-60">
          Experiments
        </p>
        <div className="space-y-4 max-w-xl">
          <B1ExperimentRunning />
          <B1ExperimentFinished />
        </div>
      </div>

      {/* ─── Coding Agent ─── */}
      <div className="space-y-3">
        <p className="text-[14px] font-semibold text-foreground tracking-wide uppercase opacity-60">
          Coding Agent
        </p>
        <div className="space-y-4 max-w-xl">
          <B1CodingRunning />
          <B1CodingFinished />
          <B1CodingFinishedArtifact />
        </div>
      </div>

      {/* ─── Knowledge Base ─── */}
      <div className="space-y-3">
        <p className="text-[14px] font-semibold text-foreground tracking-wide uppercase opacity-60">
          Knowledge Base
        </p>
        <div className="space-y-4 max-w-xl">
          <B1KnowledgeIngestionRunning />
          <B1KnowledgeIngestionFinished />
          <B1KnowledgeSessionRunning />
          <B1KnowledgeSessionFinished />
        </div>
      </div>

      {/* ─── Scheduled ─── */}
      <div className="space-y-3">
        <p className="text-[14px] font-semibold text-foreground tracking-wide uppercase opacity-60">
          Scheduled
        </p>
        <div className="space-y-4 max-w-xl">
          <B1ScheduleExperimentRunning />
          <B1ScheduleExperimentFinished />
          <B1ScheduleKBIngestionRunning />
          <B1ScheduleKBIngestionFinished />
          <B1ScheduleSessionRunning />
          <B1ScheduleSessionFinished />
          <B1ScheduleSessionFinishedArtifact />
        </div>
      </div>
    </div>
  );
}

/* ─── Experiment cards ─── */

function B1ExperimentRunning() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Experiment — Running
      </p>
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.03] p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug">
              Spring palette — warm vs cool{" "}
              <WorkingDots
                className="text-blue-500 inline-flex align-middle ml-1"
                size="md"
              />
            </p>
            <p className="text-[14px] text-muted-foreground mt-1">
              color-palette-testing
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            12m
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 py-1.5 px-2 rounded-md bg-blue-500/[0.05] border border-blue-500/20">
          <div className="flex items-center gap-1.5">
            <div className="flex gap-px">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-[3px] rounded-full",
                    i < 3 ? "bg-blue-500/70" : "bg-muted-foreground/20",
                  )}
                  style={{ height: `${8 + i * 2}px` }}
                />
              ))}
            </div>
            <span className="text-[14px] tabular-nums text-muted-foreground">
              48 runs
            </span>
          </div>
          <span className="text-[14px] text-muted-foreground">·</span>
          <span className="text-[14px] tabular-nums text-muted-foreground">
            3 variants
          </span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-blue-500/20">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1ExperimentFinished() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Experiment — Finished with dashboard
      </p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug">
              Spring palette — warm vs cool
            </p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              color-palette-testing
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            10h ago
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 py-1.5 px-2 rounded-md bg-muted/40 border border-border/40">
          <div className="flex items-center gap-1.5">
            <div className="flex gap-px">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-[3px] rounded-full",
                    i < 4 ? "bg-amber-500/70" : "bg-muted-foreground/20",
                  )}
                  style={{ height: `${8 + i * 2}px` }}
                />
              ))}
            </div>
            <span className="text-[14px] tabular-nums text-muted-foreground">
              120 runs
            </span>
          </div>
          <span className="text-[14px] text-muted-foreground">·</span>
          <span className="text-[14px] tabular-nums font-medium text-foreground">
            0.87
          </span>
          <span className="text-[14px] text-muted-foreground">·</span>
          <span className="text-[14px] tabular-nums text-muted-foreground">
            3 variants
          </span>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 hover:border-foreground/20 transition-all text-[14px] text-muted-foreground"
        >
          <Document size={16} className="shrink-0" />
          <span className="truncate max-w-[160px]">experiment-dashboard</span>
          <span className="text-[14px] font-mono opacity-60">HTML</span>
        </button>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[14px] text-muted-foreground ml-auto"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Coding Agent cards ─── */

function B1CodingRunning() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Coding Agent — Running
      </p>
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.03] p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug">
              Implement dark mode toggle{" "}
              <WorkingDots
                className="text-blue-500 inline-flex align-middle ml-1"
                size="md"
              />
            </p>
            <p className="text-[14px] text-muted-foreground mt-1">
              frontend-agent
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            12m
          </span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-blue-500/20">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1CodingFinished() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Coding Agent — Finished
      </p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug">
              Refactor auth middleware
            </p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              backend-refactor
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            45m ago
          </span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[14px] text-muted-foreground ml-auto"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1CodingFinishedArtifact() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Coding Agent — Finished with artifact
      </p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug">
              Generate marketing copy
            </p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              copywriting-agent
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            1h ago
          </span>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 hover:border-foreground/20 transition-all text-[14px] text-muted-foreground"
        >
          <Document size={16} className="shrink-0" />
          <span className="truncate max-w-[160px]">campaign-copy-v3.md</span>
          <span className="text-[14px] font-mono opacity-60">MD</span>
        </button>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[14px] text-muted-foreground ml-auto"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Knowledge Base cards ─── */

function B1KnowledgeIngestionRunning() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Knowledge Base — Ingestion Running
      </p>
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.03] p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug">
              Ingest API documentation{" "}
              <WorkingDots
                className="text-blue-500 inline-flex align-middle ml-1"
                size="md"
              />
            </p>
            <p className="text-[14px] text-muted-foreground mt-1">
              knowledge-ingestion
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            8m
          </span>
        </div>
        <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-blue-500/[0.05] border border-blue-500/20">
          <Book size={16} className="text-blue-500/70 shrink-0" />
          <span className="text-[14px] text-muted-foreground">
            142 documents indexed
          </span>
          <span className="text-[14px] text-muted-foreground/50">·</span>
          <span className="text-[14px] text-muted-foreground">processing…</span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-blue-500/20">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1KnowledgeIngestionFinished() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Knowledge Base — Ingestion Finished
      </p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug">
              Ingest API documentation
            </p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              knowledge-ingestion
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            2h ago
          </span>
        </div>
        <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/40 border border-border/40">
          <Book size={16} className="text-muted-foreground shrink-0" />
          <span className="text-[14px] text-muted-foreground">
            312 documents indexed
          </span>
          <span className="text-[14px] text-muted-foreground/50">·</span>
          <span className="text-[14px] font-medium text-foreground">ready</span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[14px] text-muted-foreground ml-auto"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1KnowledgeSessionRunning() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Knowledge Base — Session Running
      </p>
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.03] p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug">
              Research competitor pricing models{" "}
              <WorkingDots
                className="text-blue-500 inline-flex align-middle ml-1"
                size="md"
              />
            </p>
            <p className="text-[14px] text-muted-foreground mt-1">
              market-research-kb
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            5m
          </span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-blue-500/20">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1KnowledgeSessionFinished() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Knowledge Base — Session Finished
      </p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug">
              Research competitor pricing models
            </p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              market-research-kb
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            30m ago
          </span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[14px] text-muted-foreground ml-auto"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Scheduled cards ─── */

function B1ScheduleExperimentRunning() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Scheduled — Experiment Running
      </p>
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.03] p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug flex items-center gap-1.5">
              <Time size={16} className="text-muted-foreground shrink-0" />
              Weekly performance regression sweep
              <WorkingDots
                className="text-blue-500 inline-flex align-middle"
                size="md"
              />
            </p>
            <p className="text-[14px] text-muted-foreground mt-1">
              perf-testing-agent
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            6m
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 py-1.5 px-2 rounded-md bg-blue-500/[0.05] border border-blue-500/20">
          <div className="flex items-center gap-1.5">
            <div className="flex gap-px">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-[3px] rounded-full",
                    i < 2 ? "bg-blue-500/70" : "bg-muted-foreground/20",
                  )}
                  style={{ height: `${8 + i * 2}px` }}
                />
              ))}
            </div>
            <span className="text-[14px] tabular-nums text-muted-foreground">
              24 runs
            </span>
          </div>
          <span className="text-[14px] text-muted-foreground">·</span>
          <span className="text-[14px] tabular-nums text-muted-foreground">
            2 variants
          </span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-blue-500/20">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1ScheduleExperimentFinished() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Scheduled — Experiment Finished with dashboard
      </p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug flex items-center gap-1.5">
              <Time size={16} className="text-muted-foreground shrink-0" />
              Weekly performance regression sweep
            </p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              perf-testing-agent
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            12h ago
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 py-1.5 px-2 rounded-md bg-muted/40 border border-border/40">
          <div className="flex items-center gap-1.5">
            <div className="flex gap-px">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-[3px] rounded-full",
                    i < 4 ? "bg-amber-500/70" : "bg-muted-foreground/20",
                  )}
                  style={{ height: `${8 + i * 2}px` }}
                />
              ))}
            </div>
            <span className="text-[14px] tabular-nums text-muted-foreground">
              86 runs
            </span>
          </div>
          <span className="text-[14px] text-muted-foreground">·</span>
          <span className="text-[14px] tabular-nums font-medium text-foreground">
            0.94
          </span>
          <span className="text-[14px] text-muted-foreground">·</span>
          <span className="text-[14px] tabular-nums text-muted-foreground">
            2 variants
          </span>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 hover:border-foreground/20 transition-all text-[14px] text-muted-foreground"
        >
          <Document size={16} className="shrink-0" />
          <span className="truncate max-w-[160px]">perf-regression-report</span>
          <span className="text-[14px] font-mono opacity-60">HTML</span>
        </button>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[14px] text-muted-foreground ml-auto"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1ScheduleKBIngestionRunning() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Scheduled — KB Ingestion Running
      </p>
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.03] p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug flex items-center gap-1.5">
              <Time size={16} className="text-muted-foreground shrink-0" />
              Nightly docs re-index
              <WorkingDots
                className="text-blue-500 inline-flex align-middle"
                size="md"
              />
            </p>
            <p className="text-[14px] text-muted-foreground mt-1">
              knowledge-ingestion
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            4m
          </span>
        </div>
        <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-blue-500/[0.05] border border-blue-500/20">
          <Book size={16} className="text-blue-500/70 shrink-0" />
          <span className="text-[14px] text-muted-foreground">
            89 documents indexed
          </span>
          <span className="text-[14px] text-muted-foreground/50">·</span>
          <span className="text-[14px] text-muted-foreground">processing…</span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-blue-500/20">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1ScheduleKBIngestionFinished() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Scheduled — KB Ingestion Finished
      </p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug flex items-center gap-1.5">
              <Time size={16} className="text-muted-foreground shrink-0" />
              Nightly docs re-index
            </p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              knowledge-ingestion
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            5h ago
          </span>
        </div>
        <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/40 border border-border/40">
          <Book size={16} className="text-muted-foreground shrink-0" />
          <span className="text-[14px] text-muted-foreground">
            512 documents indexed
          </span>
          <span className="text-[14px] text-muted-foreground/50">·</span>
          <span className="text-[14px] font-medium text-foreground">ready</span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[14px] text-muted-foreground ml-auto"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1ScheduleSessionRunning() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Scheduled — Session Running
      </p>
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.03] p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug flex items-center gap-1.5">
              <Time size={16} className="text-muted-foreground shrink-0" />
              Nightly dependency check
              <WorkingDots
                className="text-blue-500 inline-flex align-middle"
                size="md"
              />
            </p>
            <p className="text-[14px] text-muted-foreground mt-1">
              maintenance-bot
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            3m
          </span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-blue-500/20">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1ScheduleSessionFinished() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Scheduled — Session Finished
      </p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug flex items-center gap-1.5">
              <Time size={16} className="text-muted-foreground shrink-0" />
              Nightly dependency check
            </p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              maintenance-bot
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            3h ago
          </span>
        </div>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[14px] text-muted-foreground ml-auto"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

function B1ScheduleSessionFinishedArtifact() {
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-muted-foreground mb-2">
        Scheduled — Session Finished with artifact
      </p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-muted/60 to-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground leading-snug flex items-center gap-1.5">
              <Time size={16} className="text-muted-foreground shrink-0" />
              Daily brand audit
            </p>
            <p className="text-[14px] text-muted-foreground mt-1.5">
              brand-asset-generator
            </p>
          </div>
          <span className="text-[14px] text-muted-foreground/50 whitespace-nowrap shrink-0">
            6h ago
          </span>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted/70 hover:border-foreground/20 transition-all text-[14px] text-muted-foreground"
        >
          <Document size={16} className="shrink-0" />
          <span className="truncate max-w-[160px]">brand-audit-jun14.pdf</span>
          <span className="text-[14px] font-mono opacity-60">PDF</span>
        </button>
        <div className="flex items-center gap-2 py-3 -mx-5 -mb-5 px-5 border-t border-border/40">
          <Button size="sm" variant="outline" className="h-8 text-[14px]">
            Go to session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-[14px] text-muted-foreground ml-auto"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Feed Cards — Final Designs (Full State Matrix)
   ═══════════════════════════════════════════════════════════════════════════ */

export function FeedActiveCard({
  icon,
  agentName,
  title,
  duration,
  statsPill,
  scheduled,
  onClick,
}: {
  icon: React.ReactNode;
  agentName: string;
  title: string;
  duration: string;
  statsPill?: React.ReactNode;
  scheduled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
            <span
              className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-all cursor-pointer"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
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

export function FeedFinishedCard({
  icon,
  agentName,
  title,
  time,
  unread,
  artifact,
  statsPill,
  scheduled,
  onDismiss,
  onArtifactClick,
  onClick,
}: {
  icon: React.ReactNode;
  agentName: string;
  title: string;
  time: string;
  unread: boolean;
  artifact?: { name: string };
  statsPill?: React.ReactNode;
  scheduled?: boolean;
  onDismiss?: () => void;
  onArtifactClick?: () => void;
  onClick?: () => void;
}) {
  return (
    <div
      className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200 cursor-pointer hover:shadow-lg"
      onClick={onClick}
    >
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
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onDismiss?.();
          }}
        >
          Dismiss
        </button>
      </div>
      {statsPill}
      {artifact && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border/50 bg-muted/40 hover:bg-muted/70 hover:border-border transition-all text-[14px] text-muted-foreground hover:text-foreground mt-3"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onArtifactClick?.();
          }}
        >
          <Document size={16} className="shrink-0" />
          <span className="truncate max-w-[160px]">{artifact.name}</span>
        </button>
      )}
      <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] text-muted-foreground">{time}</span>
          {scheduled && (
            <span
              className="opacity-0 group-hover:opacity-100 text-[14px] text-muted-foreground/60 hover:text-muted-foreground transition-all cursor-pointer"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
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

export function experimentPill(
  runs: string,
  status: string,
  statusColor?: string,
) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
      <span className="text-[14px] text-muted-foreground tabular-nums">
        {runs}
      </span>
      <span className="text-[14px] text-muted-foreground/40">·</span>
      <span
        className={cn(
          "text-[14px] tabular-nums",
          statusColor || "text-muted-foreground",
        )}
      >
        {status}
      </span>
    </div>
  );
}

function FeedCodingAgentCards() {
  let n = 0;
  return (
    <div className="space-y-6 max-w-xl">
      <CardEntry
        number={++n}
        title="Active — Ongoing Session"
        description="Code icon. Working dots. Arrow on hover. No dismiss (still active)."
      >
        <FeedActiveCard
          icon={<Code size={16} className="shrink-0" />}
          agentName="frontend-agent"
          title="Implement dark mode toggle"
          duration="12m"
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Active — Scheduled Ongoing Session"
        description="Time icon replaces agent icon for scheduled runs. 'Edit schedule' appears on hover in footer (tertiary)."
      >
        <FeedActiveCard
          icon={<Time size={16} className="shrink-0" />}
          agentName="maintenance-bot"
          title="Nightly dependency update"
          duration="4m"
          scheduled
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session (Unread)"
        description="Blue dot = unread. Dismiss on hover. Arrow on hover."
      >
        <FeedFinishedCard
          icon={<Code size={16} className="shrink-0" />}
          agentName="backend-refactor"
          title="Refactor auth middleware"
          time="45m ago"
          unread
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session with Artifact (Unread)"
        description="Artifact chip independently clickable. Card click → session."
      >
        <FeedFinishedCard
          icon={<Code size={16} className="shrink-0" />}
          agentName="copywriting-agent"
          title="Generate marketing copy"
          time="1h ago"
          unread
          artifact={{ name: "campaign-copy-v3.md" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session (Unread)"
        description="Time icon shows scheduled. 'Edit schedule' tertiary link in footer on hover."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="maintenance-bot"
          title="Nightly dependency check"
          time="3h ago"
          unread
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session with Artifact (Unread)"
        description="Scheduled + artifact combo."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="report-agent"
          title="Weekly code coverage report"
          time="6h ago"
          unread
          artifact={{ name: "coverage-report-aug14.pdf" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session (Read)"
        description="No blue dot. Already visited. Dismiss still available."
      >
        <FeedFinishedCard
          icon={<Code size={16} className="shrink-0" />}
          agentName="backend-refactor"
          title="Refactor auth middleware"
          time="45m ago"
          unread={false}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session with Artifact (Read)"
        description="Read state with artifact."
      >
        <FeedFinishedCard
          icon={<Code size={16} className="shrink-0" />}
          agentName="copywriting-agent"
          title="Generate marketing copy"
          time="1h ago"
          unread={false}
          artifact={{ name: "campaign-copy-v3.md" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session (Read)"
        description="Read scheduled session."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="maintenance-bot"
          title="Nightly dependency check"
          time="3h ago"
          unread={false}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session with Artifact (Read)"
        description="Read scheduled + artifact."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="report-agent"
          title="Weekly code coverage report"
          time="6h ago"
          unread={false}
          artifact={{ name: "coverage-report-aug14.pdf" }}
        />
      </CardEntry>
    </div>
  );
}

function FeedKnowledgeBaseCards() {
  let n = 0;
  return (
    <div className="space-y-6 max-w-xl">
      <CardEntry
        number={++n}
        title="Active — Ongoing Session"
        description="Book icon for knowledge base agents."
      >
        <FeedActiveCard
          icon={<Book size={16} className="shrink-0" />}
          agentName="docs-indexer"
          title="Re-index API documentation"
          duration="8m"
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Active — Scheduled Ongoing Session"
        description="Scheduled knowledge base run. 'Edit schedule' tertiary in footer."
      >
        <FeedActiveCard
          icon={<Time size={16} className="shrink-0" />}
          agentName="wiki-sync"
          title="Sync Confluence pages"
          duration="2m"
          scheduled
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session (Unread)"
        description="Knowledge base session completed."
      >
        <FeedFinishedCard
          icon={<Book size={16} className="shrink-0" />}
          agentName="docs-indexer"
          title="Re-index API documentation"
          time="20m ago"
          unread
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session with Artifact (Unread)"
        description="Knowledge base produced an artifact."
      >
        <FeedFinishedCard
          icon={<Book size={16} className="shrink-0" />}
          agentName="research-agent"
          title="Competitive analysis sweep"
          time="1h ago"
          unread
          artifact={{ name: "competitor-matrix.csv" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session (Unread)"
        description="Scheduled knowledge base run finished."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="wiki-sync"
          title="Sync Confluence pages"
          time="4h ago"
          unread
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session with Artifact (Unread)"
        description="Scheduled + artifact."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="wiki-sync"
          title="Weekly knowledge digest"
          time="8h ago"
          unread
          artifact={{ name: "digest-aug14.md" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session (Read)"
        description="Already reviewed."
      >
        <FeedFinishedCard
          icon={<Book size={16} className="shrink-0" />}
          agentName="docs-indexer"
          title="Re-index API documentation"
          time="20m ago"
          unread={false}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session with Artifact (Read)"
        description="Read with artifact."
      >
        <FeedFinishedCard
          icon={<Book size={16} className="shrink-0" />}
          agentName="research-agent"
          title="Competitive analysis sweep"
          time="1h ago"
          unread={false}
          artifact={{ name: "competitor-matrix.csv" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session (Read)"
        description="Read scheduled."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="wiki-sync"
          title="Sync Confluence pages"
          time="4h ago"
          unread={false}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session with Artifact (Read)"
        description="Read scheduled + artifact."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="wiki-sync"
          title="Weekly knowledge digest"
          time="8h ago"
          unread={false}
          artifact={{ name: "digest-aug14.md" }}
        />
      </CardEntry>
    </div>
  );
}

function FeedExperimentCards() {
  let n = 0;
  return (
    <div className="space-y-6 max-w-xl">
      <CardEntry
        number={++n}
        title="Active — Ongoing Session"
        description="Chemistry icon + stats pill with live variant count."
      >
        <FeedActiveCard
          icon={<Chemistry size={16} className="shrink-0" />}
          agentName="perf-testing-agent"
          title="Weekly performance regression sweep"
          duration="6m"
          statsPill={experimentPill("24 runs", "2 live", "text-blue-500")}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Active — Scheduled Ongoing Session"
        description="Scheduled experiment in progress. 'Edit schedule' tertiary in footer."
      >
        <FeedActiveCard
          icon={<Time size={16} className="shrink-0" />}
          agentName="nightly-bench"
          title="Nightly latency benchmark"
          duration="3m"
          scheduled
          statsPill={experimentPill("8 runs", "1 live", "text-blue-500")}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session (Unread)"
        description="Experiment complete with final stats."
      >
        <FeedFinishedCard
          icon={<Chemistry size={16} className="shrink-0" />}
          agentName="color-palette-testing"
          title="Spring palette — warm vs cool"
          time="10h ago"
          unread
          statsPill={experimentPill("120 runs", "best 0.87")}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session with Artifact (Unread)"
        description="Experiment produced a report artifact."
      >
        <FeedFinishedCard
          icon={<Chemistry size={16} className="shrink-0" />}
          agentName="prompt-optimizer"
          title="System prompt A/B test"
          time="2h ago"
          unread
          statsPill={experimentPill("50 runs", "best 0.92")}
          artifact={{ name: "prompt-results.json" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session (Unread)"
        description="Scheduled experiment finished."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="nightly-bench"
          title="Nightly latency benchmark"
          time="5h ago"
          unread
          statsPill={experimentPill("200 runs", "p95 42ms")}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session with Artifact (Unread)"
        description="Scheduled experiment + artifact."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="nightly-bench"
          title="Nightly latency benchmark"
          time="5h ago"
          unread
          statsPill={experimentPill("200 runs", "p95 42ms")}
          artifact={{ name: "bench-aug14.csv" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session (Read)"
        description="Read experiment."
      >
        <FeedFinishedCard
          icon={<Chemistry size={16} className="shrink-0" />}
          agentName="color-palette-testing"
          title="Spring palette — warm vs cool"
          time="10h ago"
          unread={false}
          statsPill={experimentPill("120 runs", "best 0.87")}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session with Artifact (Read)"
        description="Read experiment + artifact."
      >
        <FeedFinishedCard
          icon={<Chemistry size={16} className="shrink-0" />}
          agentName="prompt-optimizer"
          title="System prompt A/B test"
          time="2h ago"
          unread={false}
          statsPill={experimentPill("50 runs", "best 0.92")}
          artifact={{ name: "prompt-results.json" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session (Read)"
        description="Read scheduled experiment."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="nightly-bench"
          title="Nightly latency benchmark"
          time="5h ago"
          unread={false}
          statsPill={experimentPill("200 runs", "p95 42ms")}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session with Artifact (Read)"
        description="Read scheduled experiment + artifact."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="nightly-bench"
          title="Nightly latency benchmark"
          time="5h ago"
          unread={false}
          statsPill={experimentPill("200 runs", "p95 42ms")}
          artifact={{ name: "bench-aug14.csv" }}
        />
      </CardEntry>
    </div>
  );
}

function FeedChannelCards() {
  let n = 0;
  return (
    <div className="space-y-6 max-w-xl">
      <CardEntry
        number={++n}
        title="Active — Ongoing Session"
        description="Hashtag icon indicates Slack channel origin. Agent name shown (not channel name)."
      >
        <FeedActiveCard
          icon={<Hashtag size={16} className="shrink-0" />}
          agentName="brand-asset-generator"
          title="Generate brand audit report"
          duration="7m"
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Active — Scheduled Ongoing Session"
        description="Scheduled channel session. Time icon + 'Edit schedule' tertiary."
      >
        <FeedActiveCard
          icon={<Time size={16} className="shrink-0" />}
          agentName="standup-summarizer"
          title="Summarize overnight PRs"
          duration="2m"
          scheduled
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session (Unread)"
        description="Channel session completed. Blue dot = unread."
      >
        <FeedFinishedCard
          icon={<Hashtag size={16} className="shrink-0" />}
          agentName="brand-asset-generator"
          title="Generate brand audit report"
          time="30m ago"
          unread
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session with Artifact (Unread)"
        description="Channel session produced an artifact."
      >
        <FeedFinishedCard
          icon={<Hashtag size={16} className="shrink-0" />}
          agentName="copywriting-agent"
          title="Draft release notes for v2.4"
          time="1h ago"
          unread
          artifact={{ name: "release-notes-v2.4.md" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session (Unread)"
        description="Scheduled channel session finished."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="standup-summarizer"
          title="Summarize overnight PRs"
          time="6h ago"
          unread
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session with Artifact (Unread)"
        description="Scheduled channel session + artifact."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="velocity-tracker"
          title="Weekly team velocity digest"
          time="12h ago"
          unread
          artifact={{ name: "velocity-week33.pdf" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session (Read)"
        description="Already reviewed channel session."
      >
        <FeedFinishedCard
          icon={<Hashtag size={16} className="shrink-0" />}
          agentName="brand-asset-generator"
          title="Generate brand audit report"
          time="30m ago"
          unread={false}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Session with Artifact (Read)"
        description="Read channel session with artifact."
      >
        <FeedFinishedCard
          icon={<Hashtag size={16} className="shrink-0" />}
          agentName="copywriting-agent"
          title="Draft release notes for v2.4"
          time="1h ago"
          unread={false}
          artifact={{ name: "release-notes-v2.4.md" }}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session (Read)"
        description="Read scheduled channel session."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="standup-summarizer"
          title="Summarize overnight PRs"
          time="6h ago"
          unread={false}
        />
      </CardEntry>

      <CardEntry
        number={++n}
        title="Finished Scheduled Session with Artifact (Read)"
        description="Read scheduled channel session + artifact."
      >
        <FeedFinishedCard
          scheduled
          icon={<Time size={16} className="shrink-0" />}
          agentName="velocity-tracker"
          title="Weekly team velocity digest"
          time="12h ago"
          unread={false}
          artifact={{ name: "velocity-week33.pdf" }}
        />
      </CardEntry>
    </div>
  );
}

function FeedNeedsAttentionCards() {
  let n = 0;
  return (
    <div className="space-y-6 max-w-xl">
      <CardEntry
        number={++n}
        title="Network Request"
        description="Consistent with other feed cards. Amber dot + agent name, title, request details, actions in footer. Dismiss on hover."
      >
        <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span>brand-asset-generator</span>
              </div>
              <p className="text-[15px] font-semibold text-foreground leading-snug">
                Wants to access network
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
              GET api.figma.com
            </span>
            <span className="text-[14px] text-muted-foreground/40">·</span>
            <span className="font-mono text-[14px] text-muted-foreground truncate">
              /v1/files/abc123
            </span>
          </div>
          <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
            <span className="text-[14px] text-muted-foreground">3m ago</span>
            <div className="flex items-center gap-2">
              <Button size="sm">Allow</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="px-2">
                    <OverflowMenuVertical size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>Allow permanently</DropdownMenuItem>
                  <DropdownMenuItem>
                    Allow all of api.figma.com
                  </DropdownMenuItem>
                  <DropdownMenuItem>Deny this request</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">
                    Deny permanently
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="-mx-1" />
                  <DropdownMenuItem>
                    <Settings size={16} />
                    Network settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </CardEntry>

      <CardEntry
        number={++n}
        title="Tool Request"
        description="Same consistent structure. Amber dot + agent name, title, tool info in stats-pill, actions in footer. Dismiss on hover."
      >
        <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span>backend-refactor</span>
              </div>
              <p className="text-[15px] font-semibold text-foreground leading-snug">
                Wants to run a command
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
              bash_execute
            </span>
            <span className="text-[14px] text-muted-foreground/40">·</span>
            <span className="font-mono text-[14px] text-muted-foreground truncate">
              npm run build
            </span>
          </div>
          <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
            <span className="text-[14px] text-muted-foreground">1m ago</span>
            <div className="flex items-center gap-2">
              <Button size="sm">Allow</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="px-2">
                    <OverflowMenuVertical size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>Allow permanently</DropdownMenuItem>
                  <DropdownMenuItem>Allow all bash commands</DropdownMenuItem>
                  <DropdownMenuItem>Deny this request</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">
                    Deny permanently
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="-mx-1" />
                  <DropdownMenuItem>
                    <Settings size={16} />
                    Network settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </CardEntry>

      <CardEntry
        number={++n}
        title="Resolved — Allowed permanently"
        description="After actioning a network request. Dot gone, rule shown in footer, dismiss on hover, Network settings link."
      >
        <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                <span>brand-asset-generator</span>
              </div>
              <p className="text-[15px] font-semibold text-foreground leading-snug">
                Wants to access network
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
              GET api.figma.com
            </span>
            <span className="text-[14px] text-muted-foreground/40">·</span>
            <span className="font-mono text-[14px] text-muted-foreground truncate">
              /v1/files/abc123
            </span>
          </div>
          <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
            <span className="text-[14px] text-muted-foreground">3m ago</span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[14px] text-muted-foreground">
                <Checkmark size={16} />
                Allowed permanently
              </span>
              <button
                type="button"
                className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
        </div>
      </CardEntry>

      <CardEntry
        number={++n}
        title="Resolved — Allowed all of host"
        description="After allowing all requests to a host. Shows the broader rule, dismiss on hover."
      >
        <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                <span>brand-asset-generator</span>
              </div>
              <p className="text-[15px] font-semibold text-foreground leading-snug">
                Wants to access network
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
              POST api.openai.com
            </span>
            <span className="text-[14px] text-muted-foreground/40">·</span>
            <span className="font-mono text-[14px] text-muted-foreground truncate">
              /v1/chat/completions
            </span>
          </div>
          <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
            <span className="text-[14px] text-muted-foreground">8m ago</span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[14px] text-muted-foreground">
                <Checkmark size={16} />
                Allowed all of api.openai.com
              </span>
              <button
                type="button"
                className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
        </div>
      </CardEntry>

      <CardEntry
        number={++n}
        title="Resolved — Denied permanently"
        description="After denying permanently. Destructive rule text, dismiss on hover."
      >
        <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                <span>backend-refactor</span>
              </div>
              <p className="text-[15px] font-semibold text-foreground leading-snug">
                Wants to run a command
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
              bash_execute
            </span>
            <span className="text-[14px] text-muted-foreground/40">·</span>
            <span className="font-mono text-[14px] text-muted-foreground truncate">
              rm -rf /tmp/cache
            </span>
          </div>
          <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
            <span className="text-[14px] text-muted-foreground">12m ago</span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[14px] text-destructive">
                <Checkmark size={16} />
                Denied permanently
              </span>
              <button
                type="button"
                className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
        </div>
      </CardEntry>

      <CardEntry
        number={++n}
        title="Resolved — Allowed all tool commands"
        description="After allowing all commands for a tool type. Tool-level rule, dismiss on hover."
      >
        <div className="group rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
                <span>backend-refactor</span>
              </div>
              <p className="text-[15px] font-semibold text-foreground leading-snug">
                Wants to run a command
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
              bash_execute
            </span>
            <span className="text-[14px] text-muted-foreground/40">·</span>
            <span className="font-mono text-[14px] text-muted-foreground truncate">
              npm run build
            </span>
          </div>
          <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
            <span className="text-[14px] text-muted-foreground">5m ago</span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[14px] text-muted-foreground">
                <Checkmark size={16} />
                Allowed all bash commands
              </span>
              <button
                type="button"
                className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
        </div>
      </CardEntry>

      <CardEntry
        number={++n}
        title="Expired — Network request"
        description="Request expired. Gray dot, 'Expired' tag, 'Set a rule' button with limited options (no Allow/Deny this request)."
      >
        <div className="rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200">
          <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
            <span>brand-asset-generator</span>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-semibold text-foreground leading-snug">
              Wants to access network
            </p>
            <span className="text-[14px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Expired
            </span>
          </div>
          <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
            <span className="font-mono text-[14px] text-muted-foreground">
              GET api.figma.com
            </span>
            <span className="text-[14px] text-muted-foreground/40">·</span>
            <span className="font-mono text-[14px] text-muted-foreground truncate">
              /v1/files/abc123
            </span>
          </div>
          <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
            <span className="text-[14px] text-muted-foreground">2h ago</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Set a rule
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Allow permanently</DropdownMenuItem>
                <DropdownMenuItem>Allow all of api.figma.com</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive">
                  Deny permanently
                </DropdownMenuItem>
                <DropdownMenuSeparator className="-mx-1" />
                <DropdownMenuItem>
                  <Settings size={16} />
                  Network settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardEntry>

      <CardEntry
        number={++n}
        title="Expired — Tool request"
        description="Same expired pattern for tool requests. Gray dot, 'Expired' tag, limited rule-setting options."
      >
        <div className="rounded-2xl border border-border bg-card/80 p-5 text-left w-full transition-all duration-200">
          <div className="flex items-center gap-1.5 mb-1 text-[14px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
            <span>backend-refactor</span>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-semibold text-foreground leading-snug">
              Wants to run a command
            </p>
            <span className="text-[14px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Expired
            </span>
          </div>
          <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-md bg-muted/40 border border-border/50 mt-3">
            <span className="font-mono text-[14px] text-muted-foreground">
              bash_execute
            </span>
            <span className="text-[14px] text-muted-foreground/40">·</span>
            <span className="font-mono text-[14px] text-muted-foreground truncate">
              npm run build
            </span>
          </div>
          <div className="flex items-center justify-between py-3 mt-4 -mx-5 -mb-5 px-5 border-t border-border">
            <span className="text-[14px] text-muted-foreground">1h ago</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Set a rule
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Allow permanently</DropdownMenuItem>
                <DropdownMenuItem>Allow all bash commands</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive">
                  Deny permanently
                </DropdownMenuItem>
                <DropdownMenuSeparator className="-mx-1" />
                <DropdownMenuItem>
                  <Settings size={16} />
                  Network settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardEntry>

      <CardEntry
        number={++n}
        title="All Cleared — Empty Feed"
        description="Shown when all items dismissed or no activity."
      >
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
      </CardEntry>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Filter Variations
   ═══════════════════════════════════════════════════════════════════════════ */

const SOURCE_TYPES = ["Agents", "Experiments", "Knowledge bases", "Channels", "Schedules"] as const;

function FilterVariations() {
  return (
    <div className="space-y-12">
      <p className="text-[14px] text-muted-foreground max-w-lg">
        The current filter handles status and time, but can't exclude source
        types (Channels, Schedules, Read items). These variations explore ways
        to add source-level filtering.
      </p>

      <FilterVariationA />
      <FilterVariationB />
      <FilterVariationC />
      <FilterVariationD />
    </div>
  );
}

function FilterVariationA() {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(SOURCE_TYPES));

  const toggle = (source: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  return (
    <CardEntry
      number={1}
      title="Variation A — Multi-select Chip Bar"
      description="A row of toggleable chips below the dropdowns. Each represents a source type and can be toggled off to hide that category. State is always visible at a glance."
    >
      <div className="space-y-3 max-w-lg">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Everything
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            All time
            <ChevronDown size={16} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_TYPES.map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => toggle(source)}
              className={cn(
                "rounded-full px-3 py-1 text-[14px] font-medium transition-colors",
                enabled.has(source)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {enabled.has(source) && <Check size={14} className="inline mr-1 -ml-0.5" />}
              {source}
            </button>
          ))}
        </div>
        <p className="text-[14px] text-muted-foreground italic">
          Showing: {[...enabled].join(", ") || "Nothing"}
        </p>
      </div>
    </CardEntry>
  );
}

function FilterVariationB() {
  const [enabled, setEnabled] = useState<Set<string>>(new Set(SOURCE_TYPES));
  const [open, setOpen] = useState(false);

  const toggle = (source: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const allOn = enabled.size === SOURCE_TYPES.length;
  const label = allOn ? "All sources" : `${enabled.size} sources`;

  return (
    <CardEntry
      number={2}
      title="Variation B — Third 'Source' Dropdown (Multi-select)"
      description="Add a third dropdown that opens a checklist menu. Uncheck items to exclude them. Compact single row, familiar pattern, scales to more categories."
    >
      <div className="space-y-3 max-w-lg">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Everything
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            All time
            <ChevronDown size={16} />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className={cn(
                "inline-flex items-center gap-1 text-[14px] transition-colors",
                allOn
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-foreground font-medium",
              )}
            >
              {label}
              <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-md py-1 min-w-[180px]">
                  {SOURCE_TYPES.map((source) => (
                    <button
                      key={source}
                      type="button"
                      onClick={() => toggle(source)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[14px] text-left transition-colors hover:bg-muted/50"
                    >
                      <span
                        className={cn(
                          "flex items-center justify-center w-4 h-4 rounded border transition-colors",
                          enabled.has(source)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {enabled.has(source) && <Check size={12} />}
                      </span>
                      <span className={enabled.has(source) ? "text-foreground" : "text-muted-foreground"}>
                        {source}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <p className="text-[14px] text-muted-foreground italic">
          Showing: {[...enabled].join(", ") || "Nothing"}
        </p>
      </div>
    </CardEntry>
  );
}

function FilterVariationC() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("all");
  const [included, setIncluded] = useState<Set<string>>(new Set(["Channels", "Schedules"]));

  const STATUSES = ["All", "Needs attention", "In progress", "Unread"] as const;
  const INCLUDABLE = ["Channels", "Schedules"] as const;

  const toggleInclude = (item: string) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  };

  const statusLabel = STATUSES.find((s) => s.toLowerCase().replace(/ /g, "-") === status) ?? "All";

  return (
    <CardEntry
      number={3}
      title="Variation C — Combined Status + Include Dropdown"
      description="Single dropdown with status options at top, divider, then include toggles for source types. Fewest top-level controls, no separate time filter."
    >
      <div className="space-y-3 max-w-lg">
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className={cn(
                "inline-flex items-center gap-1 text-[14px] transition-colors",
                "text-muted-foreground hover:text-foreground",
              )}
            >
              {statusLabel}
              <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} />
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-md py-1 min-w-[200px]">
                  {STATUSES.map((s) => {
                    const key = s.toLowerCase().replace(/ /g, "-");
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setStatus(key);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-[14px] transition-colors",
                          status === key
                            ? "text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                        )}
                      >
                        {s}
                      </button>
                    );
                  })}
                  <div className="border-t border-border my-1" />
                  <p className="px-3 py-1 text-[12px] text-muted-foreground font-medium uppercase tracking-wide">
                    Include
                  </p>
                  {INCLUDABLE.map((item) => (
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
                        {included.has(item) && <Check size={12} />}
                      </span>
                      <span className={included.has(item) ? "text-foreground" : "text-muted-foreground"}>
                        {item}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <p className="text-[14px] text-muted-foreground italic">
          Status: {statusLabel} · Including: {[...included].join(", ") || "None"}
        </p>
      </div>
    </CardEntry>
  );
}

function FilterVariationD() {
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const EXCLUDABLE = ["Channels", "Schedules", "Read items", "Experiments", "Knowledge bases"] as const;
  const available = EXCLUDABLE.filter((item) => !excluded.has(item));

  const addExclusion = (item: string) => {
    setExcluded((prev) => new Set([...prev, item]));
    setExcludeOpen(false);
  };

  const removeExclusion = (item: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.delete(item);
      return next;
    });
  };

  return (
    <CardEntry
      number={4}
      title="Variation D — Exclude Pills (Additive)"
      description="Keep the two dropdowns as-is. A '+ Filter' button adds exclude pills as needed. Zero noise in default state, explicit about what's excluded, easy to undo one at a time."
    >
      <div className="space-y-3 max-w-lg">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Everything
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
          >
            All time
            <ChevronDown size={16} />
          </button>
          {[...excluded].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => removeExclusion(item)}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[14px] text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <X size={14} className="shrink-0" />
              {item}
            </button>
          ))}
          {available.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setExcludeOpen(!excludeOpen)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[14px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <Add size={14} className="shrink-0" />
                Filter
              </button>
              {excludeOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExcludeOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-md py-1 min-w-[160px]">
                    <p className="px-3 py-1 text-[12px] text-muted-foreground font-medium uppercase tracking-wide">
                      Exclude
                    </p>
                    {available.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => addExclusion(item)}
                        className="w-full text-left px-3 py-1.5 text-[14px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <p className="text-[14px] text-muted-foreground italic">
          Excluding: {excluded.size > 0 ? [...excluded].join(", ") : "Nothing (showing all)"}
        </p>
      </div>
    </CardEntry>
  );
}
