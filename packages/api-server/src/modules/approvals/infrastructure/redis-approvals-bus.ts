import type { RedisBus } from "../../../core/redis-bus.js";

export type ResolutionListener = (approvalId: string) => void;

export interface ApprovalsBus {
  notifyResolved(approvalId: string): Promise<void>;
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
