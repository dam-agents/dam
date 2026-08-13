import type { Experiment } from "api-server-api";
import { useCallback, useMemo, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { useAcpSessions } from "../../sessions/api/queries.js";
import { useAgentExperimentsLive } from "../api/queries.js";

function isLive(status: Experiment["status"]): boolean {
  return status === "draft" || status === "running";
}

export function useDockedExperiment(agentId: string | null): {
  experiment: Experiment | null;
  options: Experiment[];
  select: (id: string) => void;
} {
  const experiments = useAgentExperimentsLive(agentId);
  const [override, setOverride] = useState<{
    agentId: string | null;
    sessionId: string | null;
    id: string;
  } | null>(null);
  const seenLive = useRef(new Set<string>());

  const sessionId = useStore((s) => s.sessionId);
  const pendingLaunch = useStore((s) => s.pendingLaunch);
  const sessionFilter = useStore((s) => s.sessionFilter);
  const listInclude = useMemo(
    () => ({
      channels: sessionFilter.includes("channels"),
      scheduled: sessionFilter.includes("scheduled"),
    }),
    [sessionFilter],
  );
  const operable = useIsAgentOperable(agentId);
  const { data: sessions } = useAcpSessions(agentId, listInclude, {
    enabled: operable,
    activeSessionId: sessionId,
  });
  const sessionExperimentId =
    sessions?.find((s) => s.sessionId === sessionId)?.experimentId ?? null;

  for (const experiment of experiments) {
    if (isLive(experiment.status)) seenLive.current.add(experiment.id);
  }
  const options = experiments.filter(
    (e) => isLive(e.status) || seenLive.current.has(e.id),
  );
  const pendingRunId =
    pendingLaunch?.focused && pendingLaunch.agentId === agentId
      ? pendingLaunch.runId
      : null;
  const fallback =
    (sessionExperimentId
      ? experiments.find((e) => e.id === sessionExperimentId)
      : undefined) ??
    experiments.find((e) => e.status === "draft") ??
    experiments.find((e) => isLive(e.status)) ??
    experiments.find((e) => seenLive.current.has(e.id)) ??
    null;
  const experiment =
    (override &&
    override.agentId === agentId &&
    override.sessionId === sessionId
      ? experiments.find((e) => e.id === override.id)
      : undefined) ??
    (pendingRunId
      ? (experiments.find((e) => e.id === pendingRunId) ?? null)
      : fallback);

  const select = useCallback(
    (id: string) => {
      setOverride({ agentId, sessionId, id });
    },
    [agentId, sessionId],
  );

  return { experiment, options, select };
}
