export interface AttachmentClaim {
  settle(bytes: number): void;
  release(): void;
}

export interface AttachmentBudget {
  reserve(bytes: number): AttachmentClaim | null;
  held(): number;
}

const NO_CLAIM: AttachmentClaim = { settle: () => {}, release: () => {} };

export function encodedFootprint(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

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
