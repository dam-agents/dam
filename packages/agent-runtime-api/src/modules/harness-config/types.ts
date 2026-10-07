import type { HarnessConfigCurrent } from "../runtime/types.js";

export interface HarnessConfigService {
  readCurrent: () => Promise<HarnessConfigCurrent>;
}
