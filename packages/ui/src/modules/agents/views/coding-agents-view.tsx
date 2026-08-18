import { Button } from "@/components/ui/button";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { SandboxList } from "../components/sandbox-list.js";
import { useAgentRows } from "../hooks/use-agent-rows.js";
import { useSandboxRowActions } from "../hooks/use-sandbox-row-actions.js";
import { isCodingAgent } from "../utils/agent-kind.js";
import { splitTemporarySandboxes } from "../utils/temporary-sandboxes.js";

export function CodingAgentsView() {
  const { agentsData, initialLoaded, rowProps, deleteAgent, suspend } =
    useAgentRows();
  const { visible, drawByDriver } = splitTemporarySandboxes(
    agentsData?.list ?? [],
  );
  const codingAgents = visible.filter(isCodingAgent);
  const { stopSandbox, deleteSandbox } = useSandboxRowActions({
    deleteAgent,
    suspend,
  });

  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const createCodingAgent = () => navigateToCreateSandbox("general-purpose");

  return (
    <div>
      <PageHeader
        title="Coding agents"
        description={
          codingAgents.length > 0
            ? "Each coding agent runs in its own isolated sandbox, with your credentials and tools injected. Open one to work with it in chat."
            : undefined
        }
        actions={
          codingAgents.length > 0 ? (
            <Button onClick={createCodingAgent}>Create coding agent</Button>
          ) : undefined
        }
      />

      {!initialLoaded && <ListSkeleton rows={2} rowHeight={70} />}

      {initialLoaded && codingAgents.length === 0 && (
        <PageEmptyState
          title="No coding agents yet"
          message="A coding agent works with your preferred harness, credentials, and tools in an isolated environment. Create one and open it in chat."
          actionLabel="Create coding agent"
          onAction={createCodingAgent}
        />
      )}

      {initialLoaded && (
        <SandboxList
          agents={codingAgents}
          drawByDriver={drawByDriver}
          rowProps={rowProps}
          onStop={(agent) => void stopSandbox(agent)}
          onDelete={(agent) => void deleteSandbox(agent)}
        />
      )}
    </div>
  );
}
