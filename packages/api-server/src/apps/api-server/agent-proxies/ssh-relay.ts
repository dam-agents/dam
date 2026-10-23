import { agentServiceAddress } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import { createActivityStamper } from "./activity-stamper.js";
import type { SessionPresence } from "./session-presence.js";
import {
  createWakeGatedRelay,
  type WakeGatedRelay,
} from "./wake-gated-relay.js";

export type SshRelay = WakeGatedRelay;

export function createSshRelay(
  namespace: string,
  repo: AgentsRepository,
  presence: SessionPresence,
  upstreamBase: (agentId: string) => string = (agentId) =>
    `ws://${agentServiceAddress(agentId, namespace)}`,
): SshRelay {
  const stamper = createActivityStamper(repo);
  return createWakeGatedRelay({
    repo,
    upstreamBase,
    upstreamPath: () => "/api/ssh",
    ensureReady: (agentId) => repo.ensureReady(agentId),
    refuse: async () => null,
    activity: null,
    holdPresence: { when: "connect", port: presence },
    onClientForwarded: (agentId) => stamper.bump(agentId),
  });
}
