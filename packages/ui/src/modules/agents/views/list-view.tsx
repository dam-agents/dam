import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpgradeAgentMutation } from "../api/mutations.js";
import { fetchSchedulesForAgent } from "../../schedules/api/queries.js";
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

  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showConfirm = useStore((s) => s.showConfirm);
  const upgrade = useUpgradeAgentMutation();

  const [modalAgent, setModalAgent] = useState<AgentView | null>(null);

  const sandboxes = agents.filter((a) => !a.kind);

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
          title="Sandboxes"
          description="Sandboxes are isolated environments for running AI agents with their own workspace, credentials, and network access."
          actions={
            <Button onClick={() => navigateToCreateSandbox()}>
              Create sandbox
            </Button>
          }
        />
      )}

      {!initialLoaded && <ListSkeleton rows={3} rowHeight={70} />}

      {initialLoaded && sandboxes.length === 0 && (
        <SandboxesEmptyState onCreate={() => navigateToCreateSandbox()} />
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
    <div className="flex flex-col items-center rounded-xl border border-border py-16 text-center anim-in">
      <h2 className="text-[20px] font-semibold text-foreground">Sandboxes</h2>
      <p className="mt-2 max-w-[480px] text-[14px] leading-relaxed text-muted-foreground">
        A sandbox is an isolated environment for running AI agents with their
        own workspace, credentials, and network access. Create one and the agent
        will help you set things up.
      </p>
      <Button className="mt-6" onClick={onCreate}>
        Create sandbox
      </Button>
    </div>
  );
}
