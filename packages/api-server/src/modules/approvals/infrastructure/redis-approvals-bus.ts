import type { RedisBus } from "../../../core/redis-bus.js";
import type { ApprovalsNotifier } from "../services/approvals-service.js";

export type ResolutionListener = (approvalId: string) => void;

export interface ApprovalsBus extends ApprovalsNotifier {
  /** Subscribe a held ext_authz call to a given approval id. The returned
   *  `unsubscribe` MUST be called whether the wake fires, the hold times out,
   *  or the connection drops. Postgres remains the source of truth — callers
   *  must re-read the pending row's status both before sleeping and after
   *  waking. */
  subscribe(approvalId: string, listener: ResolutionListener): () => void;
}

const channelOf = (id: string) => `approval:${id}`;

/**
 * Cross-replica wake-up for held ext_authz calls. The signal path is the
 * shared RedisBus on `approval:<id>`; the truth path is Postgres.
 */
export function createRedisApprovalsBus(bus: RedisBus): ApprovalsBus {
  return {
    notifyResolved: (id) => bus.publish(channelOf(id), ""),
    subscribe: (id, listener) => bus.subscribe(channelOf(id), () => listener(id)),
  };
}
