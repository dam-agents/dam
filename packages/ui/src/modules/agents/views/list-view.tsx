import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useDemoState } from "../../../mock/demo-state.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";
import { useUpgradeAgentMutation } from "../api/mutations.js";
import { AgentRow } from "../components/agent-row.js";
import { SandboxDetailModal } from "../components/sandbox-detail-modal.js";
import { UpdatesAvailableBanner } from "../components/updates-available-banner.js";
import { useAgentRows } from "../hooks/use-agent-rows.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

export function ListView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend } =
    useAgentRows();
  const { visible: agents, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );

  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);
  const upgrade = useUpgradeAgentMutation();
  const { state: demoState } = useDemoState();

  const [modalAgent, setModalAgent] = useState<AgentView | null>(null);

  const sandboxes = agents.filter((a) => !a.kind);

  const goToSetup = () => {
    window.location.href = "/agent-setup";
  };

  if (import.meta.env.VITE_MOCK && demoState === "empty") {
    return <SandboxesEmptyState onCreate={goToSetup} />;
  }

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

  return (
    <div>
      {initialLoaded && sandboxes.length > 0 && (
        <PageHeader
          title="Coding agents"
          description="Coding agents run in isolated environments with their own workspace, credentials, and network access."
          actions={<Button onClick={goToSetup}>Create coding agent</Button>}
        />
      )}

      {!initialLoaded && <ListSkeleton rows={3} rowHeight={70} />}

      {initialLoaded && sandboxes.length === 0 && (
        <SandboxesEmptyState onCreate={goToSetup} />
      )}

      {initialLoaded && sandboxes.length > 0 && (
        <>
          <UpdatesAvailableBanner agents={sandboxes} />
          <div className="flex flex-col gap-3">
            {sandboxes.map((agent) => (
              <AgentRow
                key={agent.id}
                {...rowProps(agent)}
                temporaryDraw={drawByDriver.get(agent.id)}
                onSelect={() => setModalAgent(agent)}
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
        </>
      )}

      {modalAgent && (
        <SandboxDetailModal
          agent={modalAgent}
          onClose={() => setModalAgent(null)}
          onOpenConfigure={() => {
            setModalAgent(null);
            navigateToSandboxHome(modalAgent.id);
          }}
        />
      )}
    </div>
  );
}

/* ─── Empty state ─── */

function SandboxesEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-8 anim-in">
      <h2 className="text-[20px] font-semibold text-foreground">
        Coding Agents
      </h2>
      <p className="mt-2 max-w-[480px] text-[14px] leading-relaxed text-muted-foreground">
        Work with your preferred coding agent, credentials, and tools in an
        isolated environment.
      </p>
      <Button className="mt-6" onClick={onCreate}>
        Create coding agent
      </Button>
    </div>
  );
}
