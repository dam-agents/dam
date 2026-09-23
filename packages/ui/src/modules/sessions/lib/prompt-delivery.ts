import type { AcpUpdate, UpdateHandler } from "../../acp/types.js";

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

export function createPromptDelivery(): PromptDelivery {
  const records = new Map<string, DeliveryRecord>();

  const clearTimer = (record: DeliveryRecord) => {
    if (record.timer !== null) {
      clearTimeout(record.timer);
      record.timer = null;
    }
  };

  return {
    beginSend: (promptId, fail) => {
      const record: DeliveryRecord = { state: "sending", timer: null, fail };
      records.set(promptId, record);
      record.timer = setTimeout(() => {
        record.timer = null;
        if (record.state !== "sending") return;
        record.fail();
      }, DELIVERY_TIMEOUT_MS);
    },
    handleUpdate: (update) => {
      const kind = update.sessionUpdate;
      if (
        kind !== "platform_prompt_accepted" &&
        kind !== "platform_prompt_started"
      )
        return;
      const record = records.get(update.promptId);
      if (!record) return;
      clearTimer(record);
      if (kind === "platform_prompt_accepted") {
        record.state = update.queued ? "queued" : "accepted";
        return;
      }
      record.state = "started";
    },
    endSend: (promptId) => {
      const record = records.get(promptId);
      if (!record) return;
      clearTimer(record);
      records.delete(promptId);
    },
    cancelAll: () => {
      for (const record of records.values()) clearTimer(record);
      records.clear();
    },
  };
}

export function withDeliveryTracking(
  delivery: PromptDelivery,
  handler: UpdateHandler,
): UpdateHandler {
  return (update, sessionId, frame) => {
    delivery.handleUpdate(update);
    handler(update, sessionId, frame);
  };
}
