import type { ArtifactTouchService } from "./modules/artifact-library/types.js";
import type { KbPublishGate } from "./modules/kb-publish/harness.js";
import type { RuntimeDeliveryService } from "./modules/runtime/types.js";

export interface HarnessContext {
  agentId: string;
  runtimeDelivery: RuntimeDeliveryService;
  artifactTouches: ArtifactTouchService;
  kbPublish: KbPublishGate;
}
