import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface TimelineSlice {
  timelineSessionId: string | null;
  openTimelineTraceId: string | null;
  setTimelineSession: (sessionId: string | null) => void;
  setOpenTimelineTrace: (traceId: string | null) => void;
}

export const createTimelineSlice: StateCreator<
  PlatformStore,
  [],
  [],
  TimelineSlice
> = (set) => ({
  timelineSessionId: null,
  openTimelineTraceId: null,
  setTimelineSession: (sessionId) =>
    set(
      sessionId
        ? {
            timelineSessionId: sessionId,
            openTimelineTraceId: null,
            openFilePath: null,
            openFileDirty: false,
            openArtifactId: null,
          }
        : { timelineSessionId: null, openTimelineTraceId: null },
    ),
  setOpenTimelineTrace: (traceId) => set({ openTimelineTraceId: traceId }),
});
