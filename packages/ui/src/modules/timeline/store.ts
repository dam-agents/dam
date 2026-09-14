import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";

export interface TimelineSlice {
  timelineSessionId: string | null;
  setTimelineSession: (sessionId: string | null) => void;
}

export const createTimelineSlice: StateCreator<
  PlatformStore,
  [],
  [],
  TimelineSlice
> = (set) => ({
  timelineSessionId: null,
  setTimelineSession: (sessionId) =>
    set(
      sessionId
        ? {
            timelineSessionId: sessionId,
            openFilePath: null,
            openFileDirty: false,
            openArtifactId: null,
          }
        : { timelineSessionId: null },
    ),
});
