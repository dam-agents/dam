/** How much attachment memory one channel worker may hold at once.
 *
 *  A per-message cap says nothing about how many messages are in flight, and the
 *  expensive stretch is the wait for a cold pod: bytes are downloaded before the
 *  turn and held until it settles. Nothing limits how many arrive at once — a
 *  messenger delivers each event as it comes — and one process runs the channel
 *  workers for a whole install, so the ceiling has to belong to the worker rather
 *  than to any one message, queue or turn.
 *
 *  Two properties make it a bound rather than a statistic:
 *
 *  - **Admission is the charge.** A caller cannot ask whether bytes fit and then
 *    charge them, because the download sits in between: every concurrent fetch
 *    would pass the same snapshot and only then pay, bounding what has settled
 *    while what is on the wire goes uncounted.
 *  - **Settlement moves both ways.** The true size is discovered after admission
 *    — a messenger's declared size is the uploading client's claim, and can
 *    understate the file — so an adjuster that could only lower would silently
 *    absorb the overrun and stop bounding anything.
 */

/** One admitted reservation. */
export interface AttachmentClaim {
  /** Correct the reservation to what actually arrived, up or down. Going up can
   *  take the budget over its ceiling: those bytes are already resident, so the
   *  honest move is to charge them and refuse the *next* admission. */
  settle(bytes: number): void;
  /** Give the bytes back. Idempotent — refusal paths and the owning turn's
   *  `finally` may both run. */
  release(): void;
}

export interface AttachmentBudget {
  /** Reserve before reading, or refuse with null. */
  reserve(bytes: number): AttachmentClaim | null;
  /** What is held right now. For logging and tests. */
  held(): number;
}

/** What `bytes` costs once encoded. The budget is denominated in this rather than
 *  in raw bytes because it is the shape the bytes take where they are held: a
 *  picture rides the prompt as base64, and a file is handed to the pod as a
 *  base64 JSON body. Reserving raw and settling encoded would leave the
 *  conversion factor — a third of every attachment — permanently uncharged. */
export function encodedFootprint(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

export function createAttachmentBudget(capBytes: number): AttachmentBudget {
  let heldBytes = 0;
  return {
    held: () => heldBytes,
    reserve(bytes) {
      if (bytes > 0 && heldBytes + bytes > capBytes) return null;
      let claimed = bytes;
      heldBytes += claimed;
      return {
        settle(actual) {
          heldBytes += actual - claimed;
          claimed = actual;
        },
        release() {
          heldBytes = Math.max(0, heldBytes - claimed);
          claimed = 0;
        },
      };
    },
  };
}
