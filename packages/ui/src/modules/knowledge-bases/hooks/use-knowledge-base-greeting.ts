import type { HarnessFamily } from "api-server-api";

import {
  type AgentGreetingOptions,
  useAgentGreeting,
} from "../../agents/hooks/use-agent-greeting.js";
import { onboardCommandFor } from "../lib/onboard-command.js";

export type ResolvedHarness =
  | { ready: false }
  | { ready: true; harness: HarnessFamily | undefined };

export function useKnowledgeBaseGreeting(
  opts: Omit<AgentGreetingOptions, "command" | "setupReady"> & {
    harness: ResolvedHarness;
  },
) {
  const { harness, ...rest } = opts;
  useAgentGreeting({
    ...rest,
    setupReady: harness.ready,
    command: onboardCommandFor(harness.ready ? harness.harness : undefined),
  });
}
