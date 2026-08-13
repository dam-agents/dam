import type { RedisBus } from "../../../core/redis-bus.js";
import type { ApprovalsNotifier } from "../services/approvals-service.js";

export type ResolutionListener = (approvalId: string) => void;

export interface ApprovalsBus extends ApprovalsNotifier {
  subscribe(approvalId: string, listener: ResolutionListener): () => void;
}

const channelOf = (id: string) => `approval:${id}`;

export function createRedisApprovalsBus(bus: RedisBus): ApprovalsBus {
  return {
    notifyResolved: (id) => bus.publish(channelOf(id), ""),
    subscribe: (id, listener) =>
      bus.subscribe(channelOf(id), () => listener(id)),
  };
}
