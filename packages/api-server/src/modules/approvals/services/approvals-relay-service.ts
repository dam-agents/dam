import type { AcpPermissionOption } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import { acpNativeRowId } from "../domain/ids.js";
import {
  injectChannelOf,
  SYNTHETIC_SESSION_PREFIX,
} from "../infrastructure/acp-frames.js";

const ACP_NATIVE_TTL_MS = 24 * 60 * 60 * 1000;

export interface RecordAcpNativePendingInput {
  agentId: string;
  sessionId: string;
  rpcId: number | string;
  ownerSub: string;
  toolName: string;
  args: unknown;
  options: readonly AcpPermissionOption[];
}

export interface ApprovalsRelayService {
  recordAcpNativePending(
    input: RecordAcpNativePendingInput,
  ): Promise<string | null>;
  resolveAcpNativeFromInSession(rowId: string): Promise<void>;
  subscribeFrameInjects(
    agentId: string,
    listener: (frame: string) => void,
  ): () => void;
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
      const rowId = acpNativeRowId(input.agentId, input.rpcId);
      await deps.repo.insertPending({
        id: rowId,
        type: "acp_native",
        agentId: input.agentId,
        ownerSub: input.ownerSub,
        sessionId: input.sessionId,
        payload: {
          kind: "acp_native",
          toolName: input.toolName,
          args: input.args,
          rpcId: input.rpcId,
          options: input.options.map((o) => ({
            optionId: o.optionId,
            kind: o.kind,
          })),
        },
        expiresAt: new Date(Date.now() + ACP_NATIVE_TTL_MS),
      });
      return rowId;
    },

    async resolveAcpNativeFromInSession(rowId) {
      await deps.repo.resolvePending(rowId, "allow_once", "in-session", {
        markDelivered: true,
      });
    },

    subscribeFrameInjects(agentId, listener) {
      return deps.bus.subscribe(injectChannelOf(agentId), listener);
    },
  };
}
