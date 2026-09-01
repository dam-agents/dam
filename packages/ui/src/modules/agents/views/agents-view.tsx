import { Button } from "@/components/ui/button";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { OutdatedTemplatesBanner } from "../components/outdated-templates-banner.js";
import { SandboxList } from "../components/sandbox-list.js";
import { useAgentRows } from "../hooks/use-agent-rows.js";
import { useSandboxRowActions } from "../hooks/use-sandbox-row-actions.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

export function AgentsView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend } =
    useAgentRows();
  const { visible, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );
  const { stopSandbox, deleteSandbox } = useSandboxRowActions({
    deleteAgent,
    suspend,
  });

  const setView = useStore((s) => s.setView);
  const createAgent = () => setView("agent-new");

  return (
    <div>
      <PageHeader
        title="Agents"
        description={
          visible.length > 0
            ? "Each agent runs in its own isolated sandbox, with your credentials and tools injected. Open one to work with it in chat."
            : undefined
        }
        actions={
          visible.length > 0 ? (
            <Button onClick={createAgent}>Create agent</Button>
          ) : undefined
        }
      />

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && <OutdatedTemplatesBanner agents={visible} />}

      {initialLoaded && visible.length === 0 && (
        <PageEmptyState
          title="No agents yet"
          message="Each agent runs on its own, with your credentials and tools. Start from a pack, or create one and configure it yourself."
          actionLabel="Create agent"
          onAction={createAgent}
        />
      )}

      {initialLoaded && (
        <SandboxList
          agents={visible}
          drawByDriver={drawByDriver}
          rowProps={rowProps}
          onStop={(agent) => void stopSandbox(agent)}
          onDelete={(agent) => void deleteSandbox(agent)}
        />
      )}
    </div>
  );
}
