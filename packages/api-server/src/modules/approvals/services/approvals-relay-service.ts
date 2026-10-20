import type { AcpPermissionOption, ApprovalVerdict } from "api-server-api";
import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { PendingApprovalRow } from "../domain/types.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import { acpNativeRowId } from "api-server-api";
import {
  injectChannelOf,
  SYNTHETIC_SESSION_PREFIX,
} from "../infrastructure/acp-frames.js";
import { verdictOfOutcome } from "../infrastructure/wrapper-response-frames.js";
import { emit, EventType } from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";

const ACP_NATIVE_TTL_MS = 24 * 60 * 60 * 1000;

interface RecordAcpNativePendingInput {
  agentId: string;
  sessionId: string;
  rpcId: number | string;
  ownerSub: string;
  toolName: string;
  toolCallId?: string;
  args: unknown;
  options: readonly AcpPermissionOption[];
}

export interface ApprovalsRelayService {
  recordAcpNativePending(
    input: RecordAcpNativePendingInput,
  ): Promise<string | null>;
  resolveAcpNativeFromInSession(
    rowId: string,
    outcome: { outcome?: unknown; optionId?: unknown; kind?: unknown },
    opts?: { authoritative?: boolean },
  ): Promise<"settled" | "absent">;
  expireAcpNative(rowId: string): Promise<"settled" | "absent">;
  settleAbsentAcpNative(input: SettleAbsentInput): Promise<void>;
  subscribeFrameInjects(
    agentId: string,
    listener: (frame: string) => void,
  ): () => void;
}

interface SettleAbsentInput {
  agentId: string;
  sessionId: string;
  rpcId: number | string;
  ownerSub: string;
  outcome?: { outcome?: unknown; optionId?: unknown; kind?: unknown };
}

interface CreateApprovalsRelayServiceDeps {
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: A re-attached client gets the open prompt again,
 * possibly under a new rpc id, so the tool call id (stable across re-sends)
 * says which earlier rows the new one replaces. They expire rather than
 * resolve: nobody decided them, and their rpc id no longer reaches the harness.
 * Scans at most the repository's list cap of pending rows per agent.
 */
async function expireSupersededRows(
  repo: ApprovalsRepository,
  rowId: string,
  input: RecordAcpNativePendingInput,
): Promise<void> {
  const pending = await repo.listPendingForInstance(input.agentId, {
    status: "pending",
  });
  for (const row of pending) {
    if (
      row.id === rowId ||
      row.sessionId !== input.sessionId ||
      row.payload.kind !== "acp_native" ||
      row.payload.toolCallId !== input.toolCallId
    )
      continue;
    if (!(await repo.expirePending(row.id))) continue;
    emit({
      type: EventType.ApprovalResolved,
      approvalId: row.id,
      agentId: row.agentId,
      ownerSub: row.ownerSub,
      resolution: "superseded",
    });
  }
}

export function createApprovalsRelayService(
  deps: CreateApprovalsRelayServiceDeps,
): ApprovalsRelayService {
  const settle: Pick<
    ApprovalsRelayService,
    "resolveAcpNativeFromInSession" | "expireAcpNative"
  > = {
    async resolveAcpNativeFromInSession(rowId, outcome, opts) {
      const row = await deps.repo.getPending(rowId);
      if (!row) return "absent";
      if (row.payload.kind !== "acp_native") return "settled";
      const verdict = verdictOfOutcome(row.payload.options ?? [], outcome, {
        reportedByRuntime: opts?.authoritative === true,
      });
      const casWon =
        row.status === "pending" &&
        (await deps.repo.resolvePending(row.id, verdict, "in-session", {
          markDelivered: true,
        }));
      const corrected =
        !casWon &&
        opts?.authoritative === true &&
        (await deps.repo.correctResolvedVerdict(row.id, verdict));
      if (!casWon) await deps.repo.markDelivered(row.id);
      if (!casWon && !corrected) return "settled";
      emit({
        type: EventType.ApprovalResolved,
        approvalId: row.id,
        agentId: row.agentId,
        ownerSub: row.ownerSub,
        resolution: verdict,
      });
      return "settled";
    },

    async expireAcpNative(rowId) {
      const row = await deps.repo.getPending(rowId);
      if (!row) return "absent";
      if (row.payload.kind !== "acp_native") return "settled";
      if (
        row.status === "resolved" ||
        !(await deps.repo.expirePending(row.id))
      ) {
        await deps.repo.markDelivered(row.id);
        return "settled";
      }
      emit({
        type: EventType.ApprovalResolved,
        approvalId: row.id,
        agentId: row.agentId,
        ownerSub: row.ownerSub,
        resolution: "expired",
      });
      return "settled";
    },
  };

  return {
    ...settle,

    async recordAcpNativePending(input) {
      if (input.sessionId.startsWith(SYNTHETIC_SESSION_PREFIX)) return null;
      const rowId = acpNativeRowId(input.agentId, input.sessionId, input.rpcId);
      const payload = {
        kind: "acp_native" as const,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        args: input.args,
        rpcId: input.rpcId,
        options: input.options.map((o) => ({
          optionId: o.optionId,
          kind: o.kind,
        })),
      };
      const written = await deps.repo.insertIfAbsent({
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
      if (input.toolCallId !== undefined)
        await expireSupersededRows(deps.repo, rowId, input).catch((err) => {
          getLogger().error(
            { reason: formatError(err), approvalId: rowId },
            "approvals.expire_superseded_error",
          );
        });
      return rowId;
    },

    async settleAbsentAcpNative(input) {
      const rowId = acpNativeRowId(input.agentId, input.sessionId, input.rpcId);
      const verdict =
        input.outcome === undefined
          ? undefined
          : verdictOfOutcome([], input.outcome, { reportedByRuntime: true });
      const written = await deps.repo.insertSettled(
        {
          id: rowId,
          type: "acp_native",
          agentId: input.agentId,
          ownerSub: input.ownerSub,
          sessionId: input.sessionId,
          payload: {
            kind: "acp_native",
            toolName: "tool call",
            rpcId: input.rpcId,
            options: [],
          },
          expiresAt: new Date(Date.now() + ACP_NATIVE_TTL_MS),
        },
        verdict === undefined
          ? { status: "expired" }
          : { status: "resolved", verdict },
      );
      if (written) {
        emit({
          type: EventType.ApprovalResolved,
          approvalId: rowId,
          agentId: input.agentId,
          ownerSub: input.ownerSub,
          resolution: verdict ?? "expired",
        });
        return;
      }
      if (input.outcome === undefined) {
        await settle.expireAcpNative(rowId);
        return;
      }
      await settle.resolveAcpNativeFromInSession(rowId, input.outcome, {
        authoritative: true,
      });
    },

    subscribeFrameInjects(agentId, listener) {
      return deps.bus.subscribe(injectChannelOf(agentId), listener);
    },
  };
}
