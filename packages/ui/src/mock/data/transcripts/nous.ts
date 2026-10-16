import type { TranscriptMeta } from "./types.js";

export function nousTranscript(): TranscriptMeta {
  return { messages: [], steps: [] };
}
