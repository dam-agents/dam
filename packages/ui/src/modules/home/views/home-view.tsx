import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpgradeAgentMutation } from "../../agents/api/mutations.js";
import { AgentRow } from "../../agents/components/agent-row.js";
import { useAgentRows } from "../../agents/hooks/use-agent-rows.js";
import { isExperimentSandbox } from "../../agents/utils/agent-kind.js";
import { splitTemporarySandboxes } from "../../agents/utils/temporary-sandboxes.js";
import { usePendingApprovals } from "../../approvals/api/queries.js";
import { ApprovalCard } from "../../approvals/components/approval-card.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import { useDriverSummaries } from "../../experiments/api/queries.js";
import { SandboxGroupCard } from "../../experiments/components/sandbox-group-card.js";
import { toSandboxGroups } from "../../experiments/lib/sandbox-groups.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";

export function HomeView() {
  return (
    <div className="space-y-8">
      <h1 className="text-[22px] font-semibold text-foreground">Home</h1>
      <ComputeResourcesSection />
      <SandboxesSection />
      <KnowledgeBasesSection />
      <ExperimentsSection />
      <ApprovalsSection />
    </div>
  );
}

/* ─── Compute Resources ─── */

function ComputeResourcesSection() {
  const { agentsData } = useAgentRows();
  const { data: budget } = useBudgetReserved();

  const agents = agentsData?.list ?? [];

  const running = agents.filter(
    (a) =>
      a.state === "running" ||
      a.state === "starting" ||
      a.state === "preparing_workspace",
  );
  const hibernating = agents.filter(
    (a) => a.state === "hibernated" || a.state === "hibernating",
  );

  const usedSlots = running.length + hibernating.length;
  const totalSlots = budget
    ? Math.max(usedSlots, Math.round(budget.cpu.ceilingMilli / 500))
    : usedSlots;

  const segments: Array<"running" | "hibernating" | "empty"> = [
    ...Array<"running">(running.length).fill("running"),
    ...Array<"hibernating">(hibernating.length).fill("hibernating"),
    ...Array<"empty">(Math.max(0, totalSlots - usedSlots)).fill("empty"),
  ];

  const summaryParts = [
    `${agents.length} sandbox${agents.length === 1 ? "" : "es"}`,
    running.length > 0 ? `${running.length} running` : null,
    hibernating.length > 0 ? `${hibernating.length} hibernating` : null,
  ].filter(Boolean);

  return (
    <section className="space-y-2">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        Compute Resources
      </h2>
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-medium text-foreground">
            Current usage
          </span>
          <span className="text-[14px] tabular-nums text-foreground">
            {usedSlots}/{totalSlots} slots
          </span>
        </div>

        {/* Segmented slot bar */}
        <div className="flex gap-1">
          {segments.map((type, i) => (
            <div
              key={i}
              className={cn(
                "h-2.5 flex-1 rounded-sm",
                type === "running" && "bg-emerald-400",
                type === "hibernating" && "bg-blue-300",
                type === "empty" && "bg-muted",
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[14px] text-muted-foreground">
            {summaryParts.join(" · ")}
          </span>
          <button
            type="button"
            className="text-[14px] font-medium text-accent hover:text-accent-hover transition-colors"
          >
            Request more budget
          </button>
        </div>
      </div>
    </section>
  );
}

/* ─── Shared section wrapper ─── */

function HomeSection({
  title,
  onViewAll,
  empty,
  children,
}: {
  title: string;
  onViewAll: () => void;
  empty?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
        <Button
          variant="ghost"
          size="sm"
          className="text-[14px] text-muted-foreground gap-1"
          onClick={onViewAll}
        >
          View all <ArrowRight size={14} />
        </Button>
      </div>
      {empty ? (
        <p className="text-[14px] text-muted-foreground py-4">{empty}</p>
      ) : (
        children
      )}
    </section>
  );
}

/* ─── Sandboxes ─── */

function SandboxesSection() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend } =
    useAgentRows();
  const { visible: agents, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );

  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);
  const setView = useStore((s) => s.setView);
  const upgrade = useUpgradeAgentMutation();

  const sandboxes = agents.filter((a) => !a.kind).slice(0, 5);

  const stopSandbox = async (agent: AgentView) => {
    const schedules = await fetchSchedulesForAgent(agent.id);
    const scheduleNote =
      schedules.length > 0 ? (
        <>
          {" "}
          This sandbox has <strong>{schedules.length} schedule(s)</strong> — the
          next fire will start it again.
        </>
      ) : null;
    const msg = (
      <>
        Stop sandbox <strong className="text-foreground">"{agent.name}"</strong>
        ? It stays stopped until you start it.{scheduleNote}
      </>
    );
    if (!(await showConfirm(msg, "Stop Sandbox"))) return;
    suspend.stop(agent.id);
  };

  const deleteSandbox = async (agent: AgentView) => {
    const msg = (
      <>
        Delete sandbox{" "}
        <strong className="text-foreground">"{agent.name}"</strong>? This will
        also delete <strong>all persistent data</strong> and cannot be undone.
      </>
    );
    if (!(await showConfirm(msg, "Delete Sandbox", { kind: "destructive" })))
      return;
    deleteAgent.mutate({ id: agent.id });
  };

  const upgradeSandbox = async (agent: AgentView) => {
    const update = agent.templateUpdate!;
    const msg = (
      <>
        Upgrade sandbox{" "}
        <strong className="text-foreground">"{agent.name}"</strong> from{" "}
        <code>{update.fromImage}</code> to <code>{update.toImage}</code>?
      </>
    );
    if (!(await showConfirm(msg, "Upgrade Sandbox"))) return;
    upgrade.mutate({ id: agent.id, expectedToImage: update.toImage });
  };

  if (!initialLoaded) return null;

  return (
    <HomeSection
      title="Sandboxes"
      onViewAll={() => setView("list")}
      empty={sandboxes.length === 0 ? "No sandboxes" : undefined}
    >
      <div className="flex flex-col gap-3">
        {sandboxes.map((agent) => (
          <AgentRow
            key={agent.id}
            {...rowProps(agent)}
            temporaryDraw={drawByDriver.get(agent.id)}
            onSelect={() => navigateToSandboxHome(agent.id)}
            onStop={() => void stopSandbox(agent)}
            onDelete={() => void deleteSandbox(agent)}
            onUpdate={
              agent.templateUpdate
                ? () => void upgradeSandbox(agent)
                : undefined
            }
          />
        ))}
      </div>
    </HomeSection>
  );
}

/* ─── Experiments ─── */

function ExperimentsSection() {
  const { data: summaries } = useDriverSummaries();
  const { agentsData } = useAgentRows();
  const navigateToExperiments = useStore((s) => s.navigateToExperiments);
  const selectAgent = useStore((s) => s.selectAgent);

  const groups = toSandboxGroups(
    summaries ?? [],
    agentsData?.list ?? [],
    isExperimentSandbox,
  ).slice(0, 3);

  const initialLoaded = summaries !== undefined && agentsData !== undefined;
  if (!initialLoaded) return null;

  return (
    <HomeSection
      title="Experiments"
      onViewAll={navigateToExperiments}
      empty={groups.length === 0 ? "No experiments" : undefined}
    >
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <SandboxGroupCard
            key={group.agentId}
            group={group}
            onOpenSandbox={selectAgent}
            onDeleteLineage={() => {}}
          />
        ))}
      </div>
    </HomeSection>
  );
}

/* ─── Knowledge Bases ─── */

function KnowledgeBasesSection() {
  const { agentsData, initialLoaded, rowProps, deleteAgent } = useAgentRows();
  const knowledgeBases = (agentsData?.list ?? [])
    .filter((a) => a.kind === "knowledge-base")
    .slice(0, 5);

  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const navigateToKnowledgeBases = useStore((s) => s.navigateToKnowledgeBases);
  const showConfirm = useStore((s) => s.showConfirm);

  const deleteKb = async (agent: AgentView) => {
    const msg = (
      <>
        Delete knowledge base{" "}
        <strong className="text-foreground">"{agent.name}"</strong>? This
        permanently removes its workspace and cannot be undone.
      </>
    );
    if (!(await showConfirm(msg, "Delete Knowledge Base", { kind: "destructive" })))
      return;
    deleteAgent.mutate({ id: agent.id });
  };

  if (!initialLoaded) return null;

  return (
    <HomeSection
      title="Knowledge bases"
      onViewAll={navigateToKnowledgeBases}
      empty={knowledgeBases.length === 0 ? "No knowledge bases" : undefined}
    >
      <div className="flex flex-col gap-3">
        {knowledgeBases.map((agent) => (
          <AgentRow
            key={agent.id}
            {...rowProps(agent)}
            hideKindBadge
            onSelect={() => openKnowledgeBase(agent.id)}
            onDelete={() => void deleteKb(agent)}
          />
        ))}
      </div>
    </HomeSection>
  );
}

/* ─── Pending Approvals (condensed) ─── */

function ApprovalsSection() {
  const { data: pending = [] } = usePendingApprovals();
  const setView = useStore((s) => s.setView);

  return (
    <HomeSection
      title="Pending approvals"
      onViewAll={() => setView("inbox")}
      empty={pending.length === 0 ? "No pending approvals" : undefined}
    >
      <div className="flex flex-col gap-3">
        {pending.slice(0, 5).map((row) => (
          <ApprovalCard key={row.id} row={row} />
        ))}
      </div>
    </HomeSection>
  );
}

