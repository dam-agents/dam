import { providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView, TemplateView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useDriverSummaries } from "../../experiments/api/queries.js";
import { useOwnerSchedules } from "../../schedules/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useDeleteAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";
import {
  sandboxSubtitle,
  type SandboxSubtitleLookup,
} from "../utils/sandbox-subtitle.js";
import {
  useRestartAgent,
  useSyncRestartingAgents,
} from "./use-restart-agent.js";
import { useSuspendAgent, useSyncPausingAgents } from "./use-suspend-agent.js";
import { useUpdateSandbox } from "./use-update-sandbox.js";
import { useWakeAgent } from "./use-wake-agent.js";

const NO_TEMPLATES: TemplateView[] = [];

export function useAgentRows() {
  const { data: templatesData } = useTemplates();
  const templates = templatesData ?? NO_TEMPLATES;
  const { data: agentsData } = useAgents();
  const connections = useAppConnections();
  const { data: driverSummaries } = useDriverSummaries({ silent: true });
  const { data: ownerSchedules } = useOwnerSchedules();
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();
  const pausingAgents = useStore((s) => s.pausingAgents);
  useSyncPausingAgents();

  const deleteAgent = useDeleteAgent();
  const suspend = useSuspendAgent();
  const { restart: restartAgent } = useRestartAgent();
  const wakeAgent = useWakeAgent();
  const update = useUpdateSandbox();

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const pausingIds = useMemo(
    () => new Set(pausingAgents.keys()),
    [pausingAgents],
  );

  const experimentCountByDriver = useMemo(() => {
    if (!driverSummaries) return undefined;
    return new Map(
      driverSummaries.map((summary) => [
        summary.driverAgentId,
        new Set(summary.experiments.map((e) => e.name)).size,
      ]),
    );
  }, [driverSummaries]);

  const scheduleCountByAgent = useMemo(() => {
    if (!ownerSchedules) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const s of ownerSchedules) {
      counts.set(s.agentId, (counts.get(s.agentId) ?? 0) + 1);
    }
    return counts;
  }, [ownerSchedules]);

  const subtitleLookup = useMemo<SandboxSubtitleLookup>(
    () => ({
      templateNameById: new Map(templates.map((t) => [t.id, t.name])),
      connectionTemplateIdById: new Map(
        (connections.data ?? []).map((c) => [c.id, c.templateId]),
      ),
    }),
    [templates, connections.data],
  );

  const nonProviderConnectionCount = (agent: AgentView): number => {
    let count = 0;
    for (const cid of agent.grantedConnectionIds) {
      const tid = subtitleLookup.connectionTemplateIdById.get(cid);
      if (tid && providerTypeForTemplateId(tid)) continue;
      count += 1;
    }
    return count;
  };

  const rowProps = (agent: AgentView) => ({
    agent,
    display: resolveAgentDisplay(agent, restartingIds, pausingIds),
    subtitle: sandboxSubtitle(agent, subtitleLookup, {
      experimentCount: experimentCountByDriver
        ? (experimentCountByDriver.get(agent.id) ?? 0)
        : undefined,
    }),
    connectionCount: nonProviderConnectionCount(agent),
    scheduleCount: scheduleCountByAgent.get(agent.id) ?? 0,
    deletePending:
      deleteAgent.isPending && deleteAgent.variables?.id === agent.id,
    updatePending: update.updatingId === agent.id,
    updateBusy: update.updatingId !== null || update.updatingAll,
    onUpdate: () => void update.updateOne(agent),
    onWake: () => wakeAgent.wake(agent.id),
    onRestart: () => restartAgent(agent.id),
    onPause: () => suspend.pause(agent.id),
    onStop: () => suspend.stop(agent.id),
  });

  return {
    agentsData,
    initialLoaded: agentsData !== undefined,
    rowProps,
    deleteAgent,
    suspend,
    update,
  };
}
