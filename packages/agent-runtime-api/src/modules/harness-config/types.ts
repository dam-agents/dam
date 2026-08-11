// Shape and semantics live with the wire contract, so one definition serves the
// live query, `hello`, and the apply reply alike.
export type { HarnessConfigCurrent } from "../runtime/types.js";
import type { HarnessConfigCurrent } from "../runtime/types.js";

export interface HarnessConfigService {
  readCurrent: () => Promise<HarnessConfigCurrent>;
}
