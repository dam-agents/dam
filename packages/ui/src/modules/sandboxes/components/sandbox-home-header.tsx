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

export function SandboxHomeHeader({
  agent,
  title,
  description,
}: {
  agent: AgentView;
  title: string;
  description?: string;
}) {
  const { updateOne, updatingId } = useUpdateSandbox();
  const migrate = useMigrateRuntime();
  const migration = useRuntimeMigrationControls();
  return (
    <PageHeader
      title={title}
      description={description}
      actions={
        <div className="flex items-center gap-2">
          <MigrateRuntimeAction
            agent={agent}
            pending={migrate.isMigrating(agent.id)}
            onMigrate={() => void migrate.migrateOne(agent)}
            controlsBusy={migration.isBusy(agent.id)}
            onAbort={() => void migration.abortOne(agent)}
            onRetry={() => void migration.retryOne(agent)}
          />
          <UpdateAvailableAction
            agent={agent}
            pending={updatingId === agent.id}
            busy={updatingId !== null}
            onUpdate={() => void updateOne(agent)}
          />
        </div>
      }
    />
  );
}
