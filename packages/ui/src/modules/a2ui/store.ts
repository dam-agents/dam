import type { SurfaceState } from "api-server-api/chat-forms";
import type { StateCreator } from "zustand";

export interface A2uiSlice {
  a2uiEdits: Readonly<Record<string, unknown>>;
  setA2uiEdit: (key: string, dataModel: unknown) => void;
}

export function a2uiEditKey(
  sessionKey: string,
  surface: Pick<SurfaceState, "id" | "generation" | "version">,
): string {
  return `${sessionKey}|${surface.id}|${surface.generation}|${surface.version}`;
}

export const createA2uiSlice: StateCreator<A2uiSlice> = (set) => ({
  a2uiEdits: {},
  setA2uiEdit: (key, dataModel) =>
    set((state) => ({ a2uiEdits: { ...state.a2uiEdits, [key]: dataModel } })),
});
