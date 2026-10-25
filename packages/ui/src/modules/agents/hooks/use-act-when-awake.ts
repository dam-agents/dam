import { useRef } from "react";

import { emitToast } from "@/lib/toast";

import {
  agentReadinessNow,
  untilAgentOperable,
  useAgent,
} from "../api/queries.js";
import { actWhenAwake } from "../lib/agent-start.js";
import { useWakeAgent } from "./use-wake-agent.js";

export function useActWhenAwake(agentId: string) {
  const { wake } = useWakeAgent();
  const name = useAgent(agentId)?.name ?? "agent";
  const inFlight = useRef(new Set<string>());

  return (key: string, act: () => unknown) =>
    void actWhenAwake({
      inFlight: inFlight.current,
      key,
      readiness: () => agentReadinessNow(agentId),
      wake: () => wake(agentId),
      untilOperable: () => untilAgentOperable(agentId),
      onWaiting: () => emitToast({ kind: "info", message: `Waking ${name}…` }),
      onFailed: () =>
        emitToast({
          kind: "error",
          message: `${name} did not start, so nothing changed.`,
        }),
      act,
    });
}
