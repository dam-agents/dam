import { agentServiceAddress } from "../../../modules/agents/infrastructure/k8s.js";
import type { AgentsRepository } from "../../../modules/agents/infrastructure/agents-repository.js";
import {
  agentStreamable,
  isAgentStoppedError,
  isAgentWakeTimeoutError,
} from "../../../modules/agents/index.js";
import { createActivityStamper } from "./activity-stamper.js";
import {
  auditEditorRuntimeCall,
  editorMayCall,
} from "./editor-runtime-access.js";
import { screenEditorFrame } from "./editor-trpc-frames.js";
import {
  createWakeGatedRelay,
  type WakeGatedRelay,
} from "./wake-gated-relay.js";

const ACTIVITY_INTERVAL_MS = 30_000;

export type AgentTrpcRelay = WakeGatedRelay;

// UNIT_BOUNDARY_DESCRIPTION: the tRPC client's keep-alive ping. While the relay holds a socket for a waking agent it answers the ping itself, so the client does not drop and redial a socket that is only waiting.
const KEEPALIVE_PING = "PING";
const KEEPALIVE_PONG = "PONG";

export function createAgentTrpcRelay(
  namespace: string,
  repo: Pick<
    AgentsRepository,
    "get" | "ensureReady" | "patchAnnotation" | "peekCached"
  >,
  upstreamBase: (agentId: string) => string = (agentId) =>
    `ws://${agentServiceAddress(agentId, namespace)}`,
): AgentTrpcRelay {
  const stamper = createActivityStamper(repo);

  const bumpActivity = async (id: string) => {
    if (!stamper.isDue(id)) return;
    try {
      if (!agentStreamable(await repo.get(id))) return;
    } catch {
      return;
    }
    stamper.stamp(id);
  };

  return createWakeGatedRelay({
    repo,
    upstreamBase,
    upstreamPath: () => "/api/trpc-ws",
    ensureReady: (agentId) => repo.ensureReady(agentId, { waitOnly: true }),
    refuse: async (agentId) => {
      const agent = await repo.get(agentId);
      return !agent || (agent.hibernated && !agent.wakeRequested)
        ? "agent not ready"
        : null;
    },
    holdPresence: { when: "none" },
    onClientFrame: (client, data, isBinary) => {
      if (isBinary || data.toString() !== KEEPALIVE_PING) return false;
      client.send(KEEPALIVE_PONG);
      return true;
    },
    clientFrameGate: (agentId, actor) => {
      const editor = actor.editor;
      if (editor === null) return null;
      return (client, data, isBinary) => {
        if (isBinary) return null;
        const screened = screenEditorFrame(data.toString(), (path) =>
          editorMayCall(editor.permissions, path),
        );
        for (const refusal of screened.refusals) client.send(refusal);
        for (const path of screened.mutations)
          auditEditorRuntimeCall(actor.sub, agentId, editor.ownerSub, path);
        if (screened.forward === null) return null;
        return screened.refusals.length === 0
          ? data
          : Buffer.from(screened.forward);
      };
    },
    activity: {
      everyMs: ACTIVITY_INTERVAL_MS,
      tick: (id) => void bumpActivity(id),
    },
    onWoken: (id) => stamper.stamp(id),
    closeOnWakeFailure: (err) =>
      isAgentWakeTimeoutError(err)
        ? `agent not ready: ${err.failure.kind}`
        : isAgentStoppedError(err)
          ? "agent not ready"
          : "agent unavailable",
  });
}
