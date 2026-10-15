import type {
  CreateElicitationResponse,
  ElicitationSchema,
} from "@agentclientprotocol/sdk";
import type { StateCreator } from "zustand";

import type { PlatformStore } from "../../../store.js";

export interface PendingElicitation {
  key: string;
  sessionId: string;
  toolCallId: string | null;
  message: string;
  schema: ElicitationSchema;
  resolve: (response: CreateElicitationResponse) => void;
}

export interface ElicitationsSlice {
  pendingElicitations: PendingElicitation[];
  addPendingElicitation: (e: PendingElicitation) => void;
  resolvePendingElicitation: (
    key: string,
    response: CreateElicitationResponse,
  ) => void;
  dismissElicitationsOfToolCall: (toolCallId: string) => void;
}

export const createElicitationsSlice: StateCreator<
  PlatformStore,
  [],
  [],
  ElicitationsSlice
> = (set, get) => ({
  pendingElicitations: [],
  addPendingElicitation: (e) =>
    set((s) => ({
      pendingElicitations: [
        ...s.pendingElicitations.filter(
          (x) =>
            x.key !== e.key &&
            (e.toolCallId === null || x.toolCallId !== e.toolCallId),
        ),
        e,
      ],
    })),
  resolvePendingElicitation: (key, response) => {
    const entry = get().pendingElicitations.find((e) => e.key === key);
    if (!entry) return;
    entry.resolve(response);
    set((s) => ({
      pendingElicitations: s.pendingElicitations.filter((e) => e.key !== key),
    }));
  },
  dismissElicitationsOfToolCall: (toolCallId) => {
    if (!get().pendingElicitations.some((e) => e.toolCallId === toolCallId))
      return;
    set((s) => ({
      pendingElicitations: s.pendingElicitations.filter(
        (e) => e.toolCallId !== toolCallId,
      ),
    }));
  },
});
