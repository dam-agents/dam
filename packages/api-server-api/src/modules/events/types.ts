import type { z } from "zod";

import type { LiveEvent } from "./schemas.js";

export interface LiveEventsService {
  ownerStream(sub: string, signal?: AbortSignal): AsyncIterable<LiveEvent>;
}
