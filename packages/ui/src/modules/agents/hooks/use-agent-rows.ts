import { useMemo } from "react";

import { useStore } from "../../../store.js";
import type { AgentView, TemplateView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useDriverSummaries } from "../../experiments/api/queries.js";
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
import { useWakeAgent } from "./use-wake-agent.js";

const NO_TEMPLATES: TemplateView[] = [];

export function useAgentRows() {
  const { data: templatesData } = useTemplates();
  const templates = templatesData ?? NO_TEMPLATES;
  const { data: agentsData } = useAgents();
  const connections = useAppConnections();
  const { data: driverSummaries } = useDriverSummaries({ silent: true });
  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();
  const pausingAgents = useStore((s) => s.pausingAgents);
  useSyncPausingAgents();

  const deleteAgent = useDeleteAgent();
  const suspend = useSuspendAgent();
  const { restart: restartAgent } = useRestartAgent();
  const wakeAgent = useWakeAgent();

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

  const subtitleLookup = useMemo<SandboxSubtitleLookup>(
    () => ({
      templateNameById: new Map(templates.map((t) => [t.id, t.name])),
      connectionTemplateIdById: new Map(
        (connections.data ?? []).map((c) => [c.id, c.templateId]),
      ),
    }),
    [templates, connections.data],
  );

  const rowProps = (agent: AgentView) => ({
    agent,
    display: resolveAgentDisplay(agent, restartingIds, pausingIds),
    subtitle: sandboxSubtitle(agent, subtitleLookup, {
      experimentCount: experimentCountByDriver
        ? (experimentCountByDriver.get(agent.id) ?? 0)
        : undefined,
    }),
    deletePending:
      deleteAgent.isPending && deleteAgent.variables?.id === agent.id,
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
  };
}
