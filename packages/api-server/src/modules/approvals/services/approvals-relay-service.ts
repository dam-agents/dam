import type { AcpPermissionOption } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { PendingApprovalRow } from "../domain/types.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import { acpNativeRowId } from "../domain/ids.js";
import {
  injectChannelOf,
  SYNTHETIC_SESSION_PREFIX,
} from "../infrastructure/acp-frames.js";
import { emit, EventType } from "../../../events.js";

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

function describesSameRequest(
  row: PendingApprovalRow,
  payload: { toolName: string; args: unknown; rpcId: number | string },
): boolean {
  if (row.payload.kind !== "acp_native") return false;
  return (
    row.payload.rpcId === payload.rpcId &&
    row.payload.toolName === payload.toolName &&
    JSON.stringify(row.payload.args) === JSON.stringify(payload.args)
  );
}

export function createApprovalsRelayService(
  deps: CreateApprovalsRelayServiceDeps,
): ApprovalsRelayService {
  return {
    async recordAcpNativePending(input) {
      if (input.sessionId.startsWith(SYNTHETIC_SESSION_PREFIX)) return null;
      const rowId = acpNativeRowId(input.agentId, input.sessionId, input.rpcId);
      const payload = {
        kind: "acp_native" as const,
        toolName: input.toolName,
        args: input.args,
        rpcId: input.rpcId,
        options: input.options.map((o) => ({
          optionId: o.optionId,
          kind: o.kind,
        })),
      };
      const written = await deps.repo.insertPending({
        id: rowId,
        type: "acp_native",
        agentId: input.agentId,
        ownerSub: input.ownerSub,
        sessionId: input.sessionId,
        payload,
        expiresAt: new Date(Date.now() + ACP_NATIVE_TTL_MS),
      });
      if (!written) {
        const held = await deps.repo.getPending(rowId);
        return held && describesSameRequest(held, payload) ? rowId : null;
      }
      emit({
        type: EventType.ApprovalRequested,
        approvalId: rowId,
        agentId: input.agentId,
        ownerSub: input.ownerSub,
      });
      return rowId;
    },

    async resolveAcpNativeFromInSession(rowId) {
      const row = await deps.repo.getPending(rowId);
      if (!row || row.status !== "pending") return;
      const casWon = await deps.repo.resolvePending(
        row.id,
        "allow_once",
        "in-session",
        { markDelivered: true },
      );
      if (casWon) {
        emit({
          type: EventType.ApprovalResolved,
          approvalId: row.id,
          agentId: row.agentId,
          ownerSub: row.ownerSub,
        });
      }
    },

    subscribeFrameInjects(agentId, listener) {
      return deps.bus.subscribe(injectChannelOf(agentId), listener);
    },
  };
}
