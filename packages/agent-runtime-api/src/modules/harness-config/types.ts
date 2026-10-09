import type {
  HarnessConfigChoice,
  HarnessConfigCurrent,
} from "../runtime/types.js";

export interface HarnessConfigService {
  readCurrent: (opts?: { harness?: string }) => Promise<HarnessConfigCurrent>;
  models: (lease: {
    harness: string;
    provider: string | null;
  }) => Promise<HarnessConfigChoice[] | null | undefined>;
}
