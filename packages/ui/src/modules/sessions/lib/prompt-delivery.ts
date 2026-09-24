import type { AcpUpdate, UpdateHandler } from "../../acp/types.js";

export const DELIVERY_TIMEOUT_MS = 60_000;
// UNIT_BOUNDARY_DESCRIPTION: a prompt sent to an agent that is not running first wakes it. The api-server holds the relay open for up to 120 s while the agent wakes and only then forwards the prompt, so the runtime cannot acknowledge before the wake ends. The wait for a waking agent is that wake budget plus the ordinary acknowledgement window; without it a wake of more than a minute, which a vm agent on a slow host takes, marked every first prompt undelivered although it was delivered.
export const WAKE_DELIVERY_TIMEOUT_MS = 120_000 + DELIVERY_TIMEOUT_MS;

export type DeliveryState = "sending" | "accepted" | "queued" | "started";

interface DeliveryRecord {
  state: DeliveryState;
  timer: ReturnType<typeof setTimeout> | null;
  fail: () => void;
}

export interface PromptDelivery {
  beginSend: (
    promptId: string,
    fail: () => void,
    opts?: { waking?: boolean },
  ) => void;
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
    beginSend: (promptId, fail, opts) => {
      const record: DeliveryRecord = { state: "sending", timer: null, fail };
      records.set(promptId, record);
      record.timer = setTimeout(
        () => {
          record.timer = null;
          if (record.state !== "sending") return;
          record.fail();
        },
        opts?.waking ? WAKE_DELIVERY_TIMEOUT_MS : DELIVERY_TIMEOUT_MS,
      );
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
