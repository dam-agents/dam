import type { RuntimeDeliveryService } from "./modules/runtime/types.js";

export interface HarnessContext {
  agentId: string;
  runtimeDelivery: RuntimeDeliveryService;
}
