import { useRef } from "react";

import { emitToast } from "@/lib/toast";

import {
  untilAgentOperable,
  useAgentsList,
  useIsAgentOperable,
} from "../api/queries.js";
import { actWhenAwake } from "../lib/agent-start.js";
import { useWakeAgent } from "./use-wake-agent.js";

export function useActWhenAwake(agentId: string) {
  const operable = useIsAgentOperable(agentId);
  const { wake } = useWakeAgent();
  const name = useAgentsList().find((a) => a.id === agentId)?.name ?? "agent";
  const inFlight = useRef(new Set<string>());

  return (key: string, act: () => unknown) =>
    void actWhenAwake({
      inFlight: inFlight.current,
      key,
      operable,
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
