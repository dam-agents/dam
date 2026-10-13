import type { z } from "zod";
import type {
  HarnessConfigChoice,
  HarnessConfigCurrent,
} from "../runtime/types.js";
import type { harnessConfigNoticeSchema } from "./schemas.js";

export type HarnessConfigNotice = z.infer<typeof harnessConfigNoticeSchema>;

export interface HarnessConfigService {
  readCurrent: (opts?: { harness?: string }) => Promise<HarnessConfigCurrent>;
  models: (lease: {
    harness: string;
    provider: string | null;
  }) => Promise<HarnessConfigChoice[] | null | undefined>;
  watch(signal?: AbortSignal): AsyncIterable<HarnessConfigNotice>;
}
