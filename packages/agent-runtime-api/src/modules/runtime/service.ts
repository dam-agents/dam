import type { ApplyStateInput, ApplyStateResult } from "./types.js";

export interface RuntimeChannelService {
  applyState(input: ApplyStateInput): Promise<ApplyStateResult>;
}
