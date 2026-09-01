import type { z } from "zod";

import type { LiveEvent, podSessionsNoticeSchema } from "./schemas.js";

export interface LiveEventsService {
  ownerStream(sub: string, signal?: AbortSignal): AsyncIterable<LiveEvent>;
}

export type PodSessionsNotice = z.infer<typeof podSessionsNoticeSchema>;

export interface PodSessionsService {
  ownerStream(
    sub: string,
    signal?: AbortSignal,
  ): AsyncIterable<PodSessionsNotice>;
}
