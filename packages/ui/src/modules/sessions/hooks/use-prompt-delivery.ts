import { useCallback, useMemo, useRef } from "react";

import type { AcpUpdate } from "../../acp/types.js";

export const DELIVERY_TIMEOUT_MS = 60_000;

export type DeliveryState = "sending" | "accepted" | "queued" | "started";

interface DeliveryRecord {
  state: DeliveryState;
  timer: ReturnType<typeof setTimeout> | null;
  fail: () => void;
}

export interface PromptDelivery {
  beginSend: (promptId: string, fail: () => void) => void;
  handleUpdate: (update: AcpUpdate) => void;
  endSend: (promptId: string) => void;
  cancelAll: () => void;
}

export function usePromptDelivery(): PromptDelivery {
  const recordsRef = useRef(new Map<string, DeliveryRecord>());

  const clearTimer = useCallback((record: DeliveryRecord) => {
    if (record.timer !== null) {
      clearTimeout(record.timer);
      record.timer = null;
    }
  }, []);

  const beginSend = useCallback((promptId: string, fail: () => void) => {
    const record: DeliveryRecord = { state: "sending", timer: null, fail };
    recordsRef.current.set(promptId, record);
    record.timer = setTimeout(() => {
      record.timer = null;
      if (record.state !== "sending") return;
      record.fail();
    }, DELIVERY_TIMEOUT_MS);
  }, []);

  const handleUpdate = useCallback(
    (update: AcpUpdate) => {
      const kind = update.sessionUpdate;
      if (
        kind !== "platform_prompt_accepted" &&
        kind !== "platform_prompt_started"
      )
        return;
      const record = recordsRef.current.get(update.promptId);
      if (!record) return;

      if (kind === "platform_prompt_accepted") {
        clearTimer(record);
        record.state = update.queued ? "queued" : "accepted";
        return;
      }

      record.state = "started";
      clearTimer(record);
    },
    [clearTimer],
  );

  const endSend = useCallback(
    (promptId: string) => {
      const record = recordsRef.current.get(promptId);
      if (!record) return;
      clearTimer(record);
      recordsRef.current.delete(promptId);
    },
    [clearTimer],
  );

  const cancelAll = useCallback(() => {
    for (const record of recordsRef.current.values()) clearTimer(record);
    recordsRef.current.clear();
  }, [clearTimer]);

  return useMemo(
    () => ({ beginSend, handleUpdate, endSend, cancelAll }),
    [beginSend, handleUpdate, endSend, cancelAll],
  );
}
