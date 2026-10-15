import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import { slotUnitOf } from "../../budgets/lib/slots.js";
import { useDeleteAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";
import { agentUsage, sandboxSubtitle } from "../utils/sandbox-subtitle.js";
import { useMigrateRuntime } from "./use-migrate-runtime.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "./use-restart-agent.js";
import { useRuntimeMigrationControls } from "./use-runtime-migration-controls.js";
import {
  useSleepAgent,
  useSyncFallingAsleepAgents,
} from "./use-sleep-agent.js";
import { useSlowStartIds } from "./use-slow-start.js";
import { useUpdateSandbox } from "./use-update-sandbox.js";
import { useWakeAgent } from "./use-wake-agent.js";

export function useAgentRows() {
  const { data: agentsData } = useAgents();
  const { data: budget } = useBudgetReserved();
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();
  const fallingAsleepAgents = useStore((s) => s.fallingAsleepAgents);
  useSyncFallingAsleepAgents();
  const slowStartIds = useSlowStartIds();

  const deleteAgent = useDeleteAgent();
  const sleep = useSleepAgent();
  const { restart: restartAgent } = useRestartAgent();
  const wakeAgent = useWakeAgent();
  const update = useUpdateSandbox();
  const migrate = useMigrateRuntime();
  const migrationControls = useRuntimeMigrationControls();

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const fallingAsleepIds = useMemo(
    () => new Set(fallingAsleepAgents.keys()),
    [fallingAsleepAgents],
  );

  const slotUnit = budget ? slotUnitOf(budget) : null;

  const rowProps = (agent: AgentView) => ({
    agent,
    display: resolveAgentDisplay(
      agent,
      restartingIds,
      fallingAsleepIds,
      slowStartIds,
    ),
    subtitle: sandboxSubtitle(agent, slotUnit),
    usage: agentUsage(agent, budget?.vm),
    deletePending:
      deleteAgent.isPending && deleteAgent.variables?.id === agent.id,
    updatePending: update.updatingId === agent.id,
    updateBusy: update.updatingId !== null,
    onUpdate: () => void update.updateOne(agent),
    migratePending: migrate.isMigrating(agent.id),
    onMigrate: () => void migrate.migrateOne(agent),
    migrationControlsBusy: migrationControls.isBusy(agent.id),
    onAbortMigration: () => void migrationControls.abortOne(agent),
    onRetryMigration: () => void migrationControls.retryOne(agent),
    onWake: () => wakeAgent.wake(agent.id),
    onRestart: () => restartAgent(agent.id),
    onSleep: () => sleep(agent.id),
  });

  return {
    agentsData,
    initialLoaded: agentsData !== undefined,
    rowProps,
    deleteAgent,
    update,
  };
}
