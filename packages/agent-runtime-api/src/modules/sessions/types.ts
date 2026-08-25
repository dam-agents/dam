import type { z } from "zod";
import type {
  podSessionListSchema,
  podSessionNoticeSchema,
  podSessionModeSchema,
  podSessionSchema,
  podSessionTypeSchema,
} from "./schemas.js";

export type PodSessionMode = z.infer<typeof podSessionModeSchema>;
export type PodSessionType = z.infer<typeof podSessionTypeSchema>;
export type PodSession = z.infer<typeof podSessionSchema>;
export type PodSessionList = z.infer<typeof podSessionListSchema>;
export type PodSessionNotice = z.infer<typeof podSessionNoticeSchema>;

export interface SessionsService {
  list(): Promise<PodSession[]>;
  watch(signal?: AbortSignal): AsyncIterable<PodSessionNotice>;
}
