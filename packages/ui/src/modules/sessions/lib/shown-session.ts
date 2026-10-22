import type { PlatformStore } from "../../../store.js";

export const shownSessionId = (s: PlatformStore) =>
  s.pendingResumeSessionId ?? s.sessionId;
