import {
  Chat,
  Chemistry,
  Folders,
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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
import { isHeldCallStillLive } from "../../approvals/lib/hold.js";
import { ArtifactPreviewDialog } from "../../artifacts/components/artifact-preview-dialog.js";
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
         SECTION: BLOCKED / NEEDS ACTION
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Blocked — Needs Your Decision" />

      <CardEntry
        number={1}
        title="Approval Card (Network Request)"
        description="Agent name (16px medium) + 'wants to access' context + mono request. Single 'Allow' button visible; all other actions (allow permanently, allow all of host, deny, deny permanently) in overflow menu."
      >
        {networkApprovals[0] ? (
          <ApprovalVariant1 row={networkApprovals[0]} />
        ) : (
          <Placeholder label="No pending network approvals in mock data" />
        )}
      </CardEntry>

      <CardEntry
        number={2}
        title="Approval Card (Tool Use)"
        description="Same layout as network card but says 'wants to use' and shows tool name. No 'Allow all of host' option in overflow."
      >
        {toolApprovals[0] ? (
          <ApprovalVariant1 row={toolApprovals[0]} />
        ) : (
          <Placeholder label="No pending tool approvals in mock data" />
        )}
      </CardEntry>

      {/* ═══════════════════════════════════════════════════════════════
         SECTION: APPROVAL CARD REDESIGNS
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Approval Card — Redesign Options" />

      {networkApprovals[0] && (
        <ApprovalCardVariants
          networkRow={networkApprovals[0]}
          toolRow={toolApprovals[0]}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════
         SECTION: RUNNING NOW
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Running Now" />

      <CardEntry
        number={3}
        title="Session Still Running"
        description="Source: sessions API → session.running === true && !session.scheduleId. An interactive session you started is still working. Shows: session title (or agent name if untitled), agent name, time since last update. Actions: 'Open' navigates into the session, 'Stop' halts the agent."
      >
        <SessionRunningCard
          title="Implement dark mode toggle"
          agentName="frontend-agent"
          updatedAt="12 min ago"
        />
      </CardEntry>

      <CardEntry
        number={4}
        title="Experiment Running"
        description="Source: useDriverSummaries() → experiment.status === 'running'. An experiment sweep is in progress. Shows: Chemistry (beaker) icon, driver agent name, experiment name, running invocations count, status badge 'Running'. We CAN show progress via TraceFeed (completedSpans / totalStages) if we fetch the feed."
      >
        <ExperimentCard
          agentName="color-palette-testing"
          experimentName="Spring palette — warm vs cool tones"
          status="running"
          runningInvocations={3}
        />
      </CardEntry>

      <CardEntry
        number={5}
        title="Scheduled Session — Next Run"
        description="Source: schedules API → schedule.enabled && schedule.status.nextRun. A schedule is armed and will fire. Shows: clock icon, schedule name, cadence (human-readable cron/rrule), next run relative time. Actions: 'Edit schedule' navigates to the schedule tab of that agent's configure page."
      >
        <ScheduleCard
          name="Daily brand audit"
          cadence="Every weekday at 9:00 AM"
          nextRun="in 3 hr"
          lastResult="success"
          enabled={true}
        />
      </CardEntry>

      {/* ═══════════════════════════════════════════════════════════════
         SECTION: READY FOR YOU
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Ready For You — Finished Work" />

      <CardEntry
        number={6}
        title="Session Finished"
        description="Source: sessions API → session.running === false && session.updatedAt > session.seenAt. Shows: session title (or agent name if untitled), agent name, relative time. Actions: 'View session' opens the session."
      >
        <SessionFinishedCard
          title="Refactor auth middleware"
          agentName="backend-refactor"
          updatedAt="45 min ago"
          scheduled={false}
        />
      </CardEntry>

      <CardEntry
        number={7}
        title="Scheduled Session Finished"
        description="Source: sessions API → session.running === false && session.scheduleId != null && session.updatedAt > session.seenAt. A scheduled job ran while you were away. Shows: session title, agent name, relative time, clock icon. Actions: 'View session' opens the session."
      >
        <SessionFinishedCard
          title="Daily brand audit"
          agentName="brand-asset-generator"
          updatedAt="6 hr ago"
          scheduled={true}
        />
      </CardEntry>

      <CardEntry
        number={8}
        title="Artifact Created"
        description="Source: artifact-library API → artifact created by an agent, shown as its own card. Uses the Folders icon (same as left rail). Actions: 'Open artifact' opens the artifact in the docked panel."
      >
        <ArtifactCard
          title="Spring campaign hero images"
          agentName="brand-asset-generator"
          updatedAt="2 hr ago"
        />
      </CardEntry>

      <CardEntry
        number={9}
        title="Artifact Created (Scheduled)"
        description="Source: artifact-library API → artifact created by an agent during a scheduled session. Same card style, different context."
      >
        <ArtifactCard
          title="Nightly performance report"
          agentName="reporting-agent"
          updatedAt="8 hr ago"
        />
      </CardEntry>

      <CardEntry
        number={10}
        title="Experiment Completed"
        description="Source: useExperiments() → experiment.status === 'completed'. An experiment sweep finished successfully. Shows: Chemistry (beaker) icon, driver agent name, experiment name, 'Completed' badge (green). Actions: 'View results' opens the experiment's results dashboard artifact (a frozen snapshot of scores/outcomes across runs)."
      >
        <ExperimentCard
          agentName="color-palette-testing"
          experimentName="Spring palette — warm vs cool tones"
          status="completed"
          runningInvocations={0}
        />
      </CardEntry>

      <CardEntry
        number={11}
        title="Schedule Last Run Failed"
        description="Source: schedules API → schedule.status.lastResult !== 'success' && lastResult !== 'skipped: quiet hours'. The most recent scheduled run produced an error. Shows: clock icon, schedule name, cadence, last result error string, next run time. Actions: 'Edit schedule' navigates to the agent's schedule config."
      >
        <ScheduleCard
          name="Nightly test suite"
          cadence="Every day at 2:00 AM"
          nextRun="in 14 hr"
          lastResult="failed: agent exceeded timeout after 45m"
          enabled={true}
        />
      </CardEntry>

      {/* ═══════════════════════════════════════════════════════════════
         SECTION: RESOURCE WIDGETS
         ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Resource Widgets" />

      <CardEntry
        number={12}
        title="Spend + Compute Resources"
        description="Side-by-side resource cards as they appear on the home page. Spend: period selector, total, top 3 bar chart. Compute: 8-cell meter (green=running, blue=awake, outlined=available), interactive legend."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SpendPreview />
          <ComputePreview />
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
}: {
  agentName: string;
  experimentName: string;
  status: "draft" | "running" | "completed" | "failed" | "stopped";
  runningInvocations: number;
  completedRuns?: number;
}) {
  const navigateToExperiments = useStore((s) => s.navigateToExperiments);
  const [stopped, setStopped] = useState(false);

  if (stopped) {
    return (
      <Card className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4">
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
          <Chemistry size={20} className="text-muted-foreground" />
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
        <Chemistry size={20} className="text-muted-foreground" />
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
          <Button size="sm" variant="outline" onClick={navigateToExperiments}>
            View results
          </Button>
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
}: {
  name: string;
  cadence: string;
  nextRun: string;
  lastResult: string;
  enabled?: boolean;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const isFailed = lastResult.startsWith("failed");

  const openSchedule = () => {
    navigateToSandboxHome("a1b2c3d4-0001-4000-8000-000000000001", "schedules");
  };

  return (
    <Card className="flex min-h-[76px] items-start justify-between gap-3 border border-border p-4">
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
        <Time size={20} className="text-muted-foreground" />
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
      <Button size="sm" variant="outline" onClick={openSchedule}>
        Edit schedule
      </Button>
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
}: {
  title: string;
  agentName: string;
  updatedAt: string;
  scheduled: boolean;
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
          <Time size={20} className="text-muted-foreground" />
        ) : (
          <Chat size={20} className="text-muted-foreground" />
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
      <Button size="sm" variant="outline" onClick={open}>
        {scheduled ? "View results" : "View session"}
      </Button>
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
}: {
  title: string;
  agentName: string;
  updatedAt: string;
  artifactId?: string;
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
          <Folders size={20} className="text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[16px] text-foreground">{title}</h3>
          </div>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {agentName} · {updatedAt}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPreviewOpen(true)}
        >
          View artifact
        </Button>
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
    <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6 flex flex-col">
      <div className="flex items-center justify-between mb-1 min-h-[32px]">
        <p className="text-[14px] text-muted-foreground">Spend</p>
        <div className="flex gap-0.5 rounded-lg bg-muted p-0.5 shrink-0">
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
    return `${cell.agentName} — ${cell.agentKind ? KIND_LABELS[cell.agentKind] : "Agent"}, ${cell.agentSize} CPU`;
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
          {cell.agentSize} CPU
        </span>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-6 flex flex-col">
      <div className="flex items-center justify-between mb-1 min-h-[32px]">
        <p className="text-[14px] text-muted-foreground">Compute resources</p>
        <span className="text-[14px] font-medium text-accent shrink-0">
          Request more
        </span>
      </div>
      <p className="text-[28px] font-bold tabular-nums text-foreground leading-none tracking-tight mb-5">
        {inUse}/{COMPUTE_TOTAL} CPU
      </p>

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
              {runningCpu} CPU
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
              CPU
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
