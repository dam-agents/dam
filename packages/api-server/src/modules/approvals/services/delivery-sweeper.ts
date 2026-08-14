import type { ApprovalsRepository } from "../infrastructure/approvals-repository.js";
import type { WrapperFrameSender } from "./approvals-service.js";
import {
  buildAcpPermissionResponse,
  pickOptionId,
} from "../infrastructure/wrapper-response-frames.js";
import { emit, EventType } from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";

export interface DeliverySweeper {
  tick(): Promise<void>;
}

export interface CreateDeliverySweeperDeps {
  repo: ApprovalsRepository;
  wrapperFrameSender: WrapperFrameSender;
  staleMs: number;
  batchSize: number;
}

export function createDeliverySweeper(
  deps: CreateDeliverySweeperDeps,
): DeliverySweeper {
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const rows = await deps.repo.listResolvedUndelivered({
        staleMs: deps.staleMs,
        limit: deps.batchSize,
      });
      for (const row of rows) {
        if (row.payload.kind !== "acp_native") continue;
        if (row.verdict === null) continue;
        const rpcId = row.payload.rpcId;
        if (rpcId === undefined || rpcId === null) continue;
        const optionId = pickOptionId(row.payload.options ?? [], row.verdict);
        const frame = JSON.stringify(
          buildAcpPermissionResponse(rpcId, optionId),
        );
        try {
          await deps.wrapperFrameSender.send(row.agentId, frame);
          await deps.repo.markDelivered(row.id);
        } catch {}
      }
      const expired = await deps.repo.expireOverdue(new Date()).catch((err) => {
        getLogger().error(
          { reason: formatError(err) },
          "approvals.expire_overdue_error",
        );
        return [];
      });
      for (const row of expired) {
        emit({
          type: EventType.ApprovalResolved,
          approvalId: row.id,
          agentId: row.agentId,
          ownerSub: row.ownerSub,
        });
      }
    } finally {
      running = false;
    }
  }

  return { tick };
}
