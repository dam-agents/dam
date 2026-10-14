import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../store.js";
import type { SurfaceState } from "./lib/conversation.js";

export interface A2uiSlice {
  a2uiEdits: Readonly<Record<string, unknown>>;
  setA2uiEdit: (key: string, dataModel: unknown) => void;
}

export function a2uiEditKey(
  sessionKey: string,
  surface: Pick<SurfaceState, "ownerKey" | "version">,
): string {
  return `${sessionKey}|${surface.ownerKey}|${surface.version}`;
}

function sessionOf(key: string): string {
  return key.slice(0, key.indexOf("|"));
}

export const createA2uiSlice: StateCreator<PlatformStore, [], [], A2uiSlice> = (
  set,
) => ({
  a2uiEdits: {},
  setA2uiEdit: (key, dataModel) =>
    set((state) => {
      const session = sessionOf(key);
      const kept = Object.fromEntries(
        Object.entries(state.a2uiEdits).filter(
          ([existing]) => sessionOf(existing) === session,
        ),
      );
      return { a2uiEdits: { ...kept, [key]: dataModel } };
    }),
});
