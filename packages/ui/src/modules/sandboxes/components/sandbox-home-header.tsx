import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui/page-header";

import { AlwaysOnTag } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { avatarMood } from "../../agents/components/avatar/agent-avatar.js";
import { EditableAgentIdentity } from "../../agents/components/editable-agent-identity.js";
import { GatewayFailureBadge } from "../../agents/components/gateway-failure-badge.js";
import { MigrateRuntimeAction } from "../../agents/components/migrate-runtime-action.js";
import { UpdateAvailableAction } from "../../agents/components/update-available-action.js";
import { useMigrateRuntime } from "../../agents/hooks/use-migrate-runtime.js";
import { useRuntimeMigrationControls } from "../../agents/hooks/use-runtime-migration-controls.js";
import { useUpdateSandbox } from "../../agents/hooks/use-update-sandbox.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { useNewLayout } from "../../features/hooks/use-new-layout.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
}

export function SandboxIdentity({ agent, display }: Props) {
  return (
    <div className="mb-4 flex flex-col gap-2 px-3">
      <div className="flex min-w-0 items-center gap-3">
        <EditableAgentIdentity
          agent={agent}
          avatarSize={36}
          mood={avatarMood(display.state, agent)}
          nameClassName="text-lg font-semibold text-foreground"
          nameTag="h2"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <GatewayFailureBadge agent={agent} />
        {agent.hibernationTimeoutMin === 0 && <AlwaysOnTag />}
      </div>
    </div>
  );
}

export type SectionHeaderSlot = (actions?: ReactNode) => ReactNode;

export function SandboxHomeHeader({
  agent,
  title,
  description,
  pictogram,
  actions,
}: {
  agent: AgentView;
  title: string;
  description?: string;
  pictogram?: ReactNode;
  actions?: ReactNode;
}) {
  const { updateOne, updatingId } = useUpdateSandbox();
  const newLayout = useNewLayout();
  return (
    <PageHeader
      title={title}
      description={description}
      pictogram={pictogram}
      actions={
        <>
          {newLayout && <MigrateAction agent={agent} />}
          <UpdateAvailableAction
            agent={agent}
            pending={updatingId === agent.id}
            busy={updatingId !== null}
            onUpdate={() => void updateOne(agent)}
          />
          {actions}
        </>
      }
    />
  );
}

function MigrateAction({ agent }: { agent: AgentView }) {
  const migrate = useMigrateRuntime();
  const controls = useRuntimeMigrationControls();
  return (
    <MigrateRuntimeAction
      agent={agent}
      pending={migrate.isMigrating(agent.id)}
      onMigrate={() => void migrate.migrateOne(agent)}
      controlsBusy={controls.isBusy(agent.id)}
      onAbort={() => void controls.abortOne(agent)}
      onRetry={() => void controls.retryOne(agent)}
    />
  );
}
