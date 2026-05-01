import type { AcpPermissionOption } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import { acpNativeRowId } from "../domain/ids.js";
import { injectChannelOf, SYNTHETIC_SESSION_PREFIX } from "../infrastructure/acp-frames.js";

/** TTL stamped on acp_native rows. The wrapper holds the awaiting promise
 *  in-process — there's no real timeout — but the column is NOT NULL. A row
 *  outliving its TTL stays visible in the inbox until the response goes
 *  through; a sweeper pass would mark inactive once we wire the wrapper
 *  heartbeat (DRAFT-unified-hitl-ux §"Inbox"). */
const ACP_NATIVE_TTL_MS = 24 * 60 * 60 * 1000;

export interface RecordAcpNativePendingInput {
  instanceId: string;
  sessionId: string;
  rpcId: number | string;
  agentId: string;
  ownerSub: string;
  toolName: string;
  args: unknown;
  options: readonly AcpPermissionOption[];
}

/**
 * Server-internal port the ACP relay consumes. The relay's HITL touchpoint
 * is just two operations: insert a pending row when the wrapper emits a
 * `session/request_permission`, and CAS-resolve it (marking delivered)
 * when an in-session response is forwarded upstream. The synth-frame
 * subscription is the only Redis hop the relay still owns — it's a UI
 * fan-out for ext_authz prompts, unrelated to ACP-native delivery.
 */
export interface ApprovalsRelayService {
  /** Returns the assigned row id, or null if the request shouldn't be
   *  mirrored (e.g. synth ext_authz frames travelling over the same WS). */
  recordAcpNativePending(input: RecordAcpNativePendingInput): Promise<string | null>;
  /** Called when the relay forwards an in-session JSON-RPC response
   *  upstream. The wrapper has already received the response, so we
   *  CAS-resolve and stamp `delivered_at` in one update. Idempotent at the
   *  DB layer — non-permission responses pass a row id that doesn't exist
   *  and the update affects zero rows. */
  resolveAcpNativeFromInSession(rowId: string): Promise<void>;
  subscribeFrameInjects(instanceId: string, listener: (frame: string) => void): () => void;
}

export interface CreateApprovalsRelayServiceDeps {
  repo: ApprovalsRepository;
  bus: RedisBus;
}

export function createApprovalsRelayService(
  deps: CreateApprovalsRelayServiceDeps,
): ApprovalsRelayService {
  return {
    async recordAcpNativePending(input) {
      if (input.sessionId.startsWith(SYNTHETIC_SESSION_PREFIX)) return null;
      const rowId = acpNativeRowId(input.instanceId, input.rpcId);
      await deps.repo.insertPending({
        id: rowId,
        type: "acp_native",
        instanceId: input.instanceId,
        agentId: input.agentId,
        ownerSub: input.ownerSub,
        sessionId: input.sessionId,
        payload: {
          kind: "acp_native",
          toolName: input.toolName,
          args: input.args,
          rpcId: input.rpcId,
          options: input.options.map((o) => ({ optionId: o.optionId, kind: o.kind })),
        },
        expiresAt: new Date(Date.now() + ACP_NATIVE_TTL_MS),
      });
      return rowId;
    },

    async resolveAcpNativeFromInSession(rowId) {
      await deps.repo.resolvePending(rowId, "allow_once", "in-session", { markDelivered: true });
    },

    subscribeFrameInjects(instanceId, listener) {
      return deps.bus.subscribe(injectChannelOf(instanceId), listener);
    },
  };
}
