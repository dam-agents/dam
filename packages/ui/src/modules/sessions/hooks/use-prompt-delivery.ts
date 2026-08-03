import { useCallback, useMemo, useRef } from "react";

import type { AcpUpdate } from "../../acp/types.js";

/** Both delivery deadlines. `sending → accepted` is the true delivery check and
 *  normally resolves in milliseconds; `started → first content` is the
 *  wedged-agent check the original send-anchored watchdog was really after. */
export const DELIVERY_TIMEOUT_MS = 60_000;

/**
 * Where a prompt is in the runtime's delivery pipeline, as reported by the
 * server:
 *   - `sending`  — the frame is on the wire, no `platform/promptAccepted` yet.
 *     The only state the delivery deadline can fail from.
 *   - `accepted` — accepted and handed straight on (`queued: false`); the
 *     `platform/promptStarted` that follows is a formality.
 *   - `queued`   — accepted and parked behind an in-flight turn. Unbounded on
 *     purpose: a prior turn may legitimately run for hours, and waiting is not
 *     a failure (issue #829). Only losing the WebSocket loses the prompt.
 *   - `started`  — handed to the agent process; content is now expected.
 */
export type DeliveryState = "sending" | "accepted" | "queued" | "started";

interface DeliveryRecord {
  state: DeliveryState;
  timer: ReturnType<typeof setTimeout> | null;
  /** Fail this prompt's bubble. Owned by `sendPrompt`, which owns the bubble:
   *  it decides between the error card with Retry and a silent drop, and
   *  no-ops if content has arrived since the timer was armed. */
  fail: () => void;
}

export interface PromptDelivery {
  /** Start tracking a fresh send: arms the `sending → accepted` deadline. */
  beginSend: (promptId: string, fail: () => void) => void;
  /** Feed every session update through; the delivery frames are picked out. */
  handleUpdate: (update: AcpUpdate) => void;
  /** Stop tracking a prompt, clearing whichever deadline is still pending. */
  endSend: (promptId: string) => void;
}

/**
 * The client half of the server-authoritative delivery contract: a per-prompt
 * state machine fed only by the runtime's `platform/promptAccepted` and
 * `platform/promptStarted` notifications.
 *
 *   sending ──accepted{queued:false}──▶ ──started──▶ started ──content──▶ done
 *   sending ──accepted{queued:true}───▶ queued ─────▶ started
 *      │                                   │              │
 *      └─ no accepted in 60s → fail        └─ no timer    └─ no content in 60s → fail
 *
 * Deliberately holds no opinion about *why* a prompt is where it is — that is
 * the runtime's business. It only owns the two deadlines and hands failure back
 * to the caller's `fail` callback.
 *
 * Records are keyed by `promptId`, so concurrent sends (a queued prompt behind
 * a running turn) each get their own deadline instead of the single shared
 * watchdog that made #829's false "Couldn't deliver" possible.
 */
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
      // An accepted frame moved this record on, so the prompt did reach the
      // runtime — whatever happens next is not a delivery failure.
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
      // Not ours: another viewer's prompt, or one whose send already settled.
      if (!record) return;

      if (kind === "platform_prompt_accepted") {
        // Delivery to the runtime is confirmed. Nothing is timed while queued.
        clearTimer(record);
        record.state = update.queued ? "queued" : "accepted";
        return;
      }

      record.state = "started";
      clearTimer(record);
      record.timer = setTimeout(() => {
        record.timer = null;
        record.fail();
      }, DELIVERY_TIMEOUT_MS);
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

  // Stable object identity: `sendPrompt`'s useCallback deps include it.
  return useMemo(
    () => ({ beginSend, handleUpdate, endSend }),
    [beginSend, handleUpdate, endSend],
  );
}
