import type { RuntimeDeliveryService } from "./modules/runtime/types.js";
import type { SessionDirectoryService } from "./modules/session-directory/types.js";

export interface HarnessContext {
  agentId: string;
  runtimeDelivery: RuntimeDeliveryService;
  sessionDirectory: SessionDirectoryService;
}
