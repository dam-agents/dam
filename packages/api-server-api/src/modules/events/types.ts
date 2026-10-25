import type { LiveEvent } from "./schemas.js";

export interface LiveEventsService {
  ownerStream(
    audience: { sub: string; editorEmail: string | null },
    signal?: AbortSignal,
  ): AsyncIterable<LiveEvent>;
}
