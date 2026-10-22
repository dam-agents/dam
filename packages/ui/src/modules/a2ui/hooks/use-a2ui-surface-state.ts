import type { SurfaceState } from "api-server-api/chat-forms";
import { setAt } from "api-server-api/chat-forms";
import { A2UI_VERSION, type FunctionCall } from "api-server-api/chat-forms";
import { useCallback, useMemo, useState } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useA2uiSendPrompt } from "../contexts/a2ui-action-context.js";
import type { A2uiScope } from "../contexts/a2ui-scope-context.js";
import type {
  A2uiEvent,
  A2uiSurfaceState,
} from "../contexts/a2ui-surface-context.js";
import { callFunction } from "../lib/functions/evaluate.js";
import { formatRendererMessage } from "../lib/prompts.js";
import { a2uiEditKey } from "../store.js";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useA2uiSurfaceState(
  surface: SurfaceState,
  live: boolean,
  sessionKey: string,
  withRendererMetadata: (text: string) => string,
): A2uiSurfaceState {
  const sendPrompt = useA2uiSendPrompt();
  const editKey = a2uiEditKey(sessionKey, surface);
  const edited = useStore((state) => state.a2uiEdits[editKey]);
  const setEdit = useStore((state) => state.setA2uiEdit);
  const dataModel = edited ?? surface.dataModel;
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  const editable =
    live && !surface.streaming && sendPrompt !== null && !sending;

  const setValue = useCallback(
    (componentId: string, path: string, value: unknown) => {
      const current =
        useStore.getState().a2uiEdits[editKey] ?? surface.dataModel;
      setEdit(editKey, setAt(current, path, value));
      setTouched((previous) =>
        previous.has(componentId)
          ? previous
          : new Set(previous).add(componentId),
      );
    },
    [editKey, setEdit, surface.dataModel],
  );

  const dispatch = useCallback(
    ({ sourceComponentId, name, userMessage, context }: A2uiEvent) => {
      if (!sendPrompt) return;
      const prompt = formatRendererMessage({
        version: A2UI_VERSION,
        action: {
          name,
          ...(userMessage ? { userMessage } : {}),
          surfaceId: surface.id,
          sourceComponentId,
          timestamp: new Date().toISOString(),
          context,
        },
      });
      setSending(true);
      sendPrompt(withRendererMetadata(prompt))
        .catch((error: unknown) =>
          emitToast({
            kind: "error",
            message: errorText(error, "Couldn't send the form."),
          }),
        )
        .finally(() => setSending(false));
    },
    [sendPrompt, surface.id, withRendererMetadata],
  );

  const runLocal = useCallback(
    (call: FunctionCall, scope: A2uiScope) => {
      try {
        callFunction(call, {
          model: dataModel,
          scope: scope.path,
          indexes: scope.indexes,
          catalogId: surface.catalogId,
          userActivation: true,
        });
      } catch (error) {
        emitToast({
          kind: "error",
          message: errorText(error, "The action failed."),
        });
      }
    },
    [dataModel, surface.catalogId],
  );

  return useMemo(
    () => ({
      surface,
      dataModel,
      editable,
      touched,
      setValue,
      dispatch,
      runLocal,
    }),
    [surface, dataModel, editable, touched, setValue, dispatch, runLocal],
  );
}
