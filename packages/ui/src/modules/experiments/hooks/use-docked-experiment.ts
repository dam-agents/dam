import type { Experiment } from "api-server-api";
import { useCallback, useMemo, useRef, useState } from "react";

import { useStore } from "../../../store.js";
import { useAcpSessions } from "../../sessions/api/queries.js";
import { useAgentExperimentsLive } from "../api/queries.js";

function isLive(status: Experiment["status"]): boolean {
  return status === "draft" || status === "running";
}

/** Which experiment (if any) should occupy the chat dock for this agent.
 *  Building and running get separate lenses: a run session shows ONLY its
 *  run; a build session (no run binding) shows the newest draft — the plan
 *  plus its "Start a new run" button. Falls back to a live run so landing
 *  on a mid-run agent without a session still surfaces the action; a run
 *  watched live stays docked through its terminal state.
 *
 *  An agent hosting several lineages gets `options` + `select`: a manual
 *  override the panel header renders as a switcher, scoped to the session
 *  it was made in — switching sessions returns to that session's own lens
 *  (a run session must dock its run, not a pick made elsewhere). */
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

  // The open session's experiment binding (session meta carries the run id).
  // Mirrors the sidebar's include so the ACP list query is a cache hit.
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
  const { data: sessions } = useAcpSessions(agentId, listInclude, {
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
  // While a launch is in focus the dock belongs to the pending run: the
  // launch blanks the session (invalidating any session-scoped pick), and
  // without this the fallback chain would flash a wrong draft until the
  // launch session opens. Until the run row lands in the polled list, show
  // nothing rather than something wrong.
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
