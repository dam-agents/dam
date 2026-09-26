import type { RedisBus } from "../../../core/redis-bus.js";

export interface ApprovalsBus {
  notifyResolved(approvalId: string): Promise<void>;
}

export const approvalChannelOf = (id: string) => `approval:${id}`;

export function createRedisApprovalsBus(bus: RedisBus): ApprovalsBus {
  return {
    notifyResolved: (id) => bus.publish(approvalChannelOf(id), ""),
  };
}
