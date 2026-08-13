/** How much attachment memory one channel worker may hold at once. Admission is
 *  the charge (the download sits between a check and a commit), settlement moves
 *  both ways (a declared size can understate the file), and a released claim is
 *  terminal (bytes with no owner must not be chargeable again). */

export interface AttachmentClaim {
  /** Correct the reservation to what arrived, up or down; going up may exceed the
   *  ceiling, which refuses the next admission. No-op once released. */
  settle(bytes: number): void;
  /** Idempotent, and terminal. */
  release(): void;
}

export interface AttachmentBudget {
  /** Reserve before reading, or refuse with null. */
  reserve(bytes: number): AttachmentClaim | null;
  held(): number;
}

const NO_CLAIM: AttachmentClaim = { settle: () => {}, release: () => {} };

/** A picture rides the prompt as base64 and a file reaches the pod as a base64
 *  JSON body, so this is the unit both are held in. */
export function encodedFootprint(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** A staged file holds its buffer for the whole turn and builds the encoded copy
 *  on top of it. */
export function stagedFootprint(bytes: number): number {
  return bytes + encodedFootprint(bytes);
}

function isChargeable(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0;
}

export function createAttachmentBudget(capBytes: number): AttachmentBudget {
  let heldBytes = 0;
  return {
    held: () => heldBytes,
    reserve(bytes) {
      // NaN in the counter makes every later comparison false, disabling the cap.
      if (!Number.isFinite(bytes) || bytes < 0) return null;
      if (!isChargeable(bytes)) return NO_CLAIM;
      if (heldBytes + bytes > capBytes) return null;

      let claimed = bytes;
      let live = true;
      heldBytes += claimed;
      return {
        settle(actual) {
          if (!live || !isChargeable(actual)) return;
          heldBytes += actual - claimed;
          claimed = actual;
        },
        release() {
          if (!live) return;
          live = false;
          heldBytes = Math.max(0, heldBytes - claimed);
          claimed = 0;
        },
      };
    },
  };
}
