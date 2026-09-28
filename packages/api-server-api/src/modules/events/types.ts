import type { LiveEvent } from "./schemas.js";

export interface LiveEventsService {
  ownerStream(sub: string, signal?: AbortSignal): AsyncIterable<LiveEvent>;
}
