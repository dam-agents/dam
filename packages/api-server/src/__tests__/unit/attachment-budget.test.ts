import { describe, expect, it } from "vitest";

import {
  createAttachmentBudget,
  encodedFootprint,
  stagedFootprint,
} from "../../modules/channels/attachment-budget.js";

/**
 * TEST_OVERVIEW: the attachment-memory budget one channel worker holds.
 *
 * One process runs the channel workers for a whole install, and an attachment
 * is downloaded before its turn and held until the turn settles — across a
 * cold-pod wake, the slow part. What bounds that is a reservation taken before
 * the bytes are read, corrected once their real size is known, and given back
 * when the turn ends. Each of those three has a way of quietly ceasing to
 * bound anything, which is what these cases pin.
 */

describe("encodedFootprint", () => {
  it("is the base64 size, which is what the bytes are held as", () => {
    expect(encodedFootprint(3)).toBe(4);
    expect(encodedFootprint(9_000_000)).toBe(12_000_000);
    expect(encodedFootprint(0)).toBe(0);
  });
});

describe("stagedFootprint", () => {
  it("counts the buffer that is held and the encoded copy built on it", () => {
    expect(stagedFootprint(3)).toBe(7);
    expect(stagedFootprint(9_000_000)).toBe(21_000_000);
  });
});

describe("createAttachmentBudget", () => {
  it("admits up to the ceiling and refuses past it", () => {
    const budget = createAttachmentBudget(100);

    expect(budget.reserve(60)).not.toBeNull();
    expect(budget.reserve(40)).not.toBeNull();
    expect(budget.held()).toBe(100);
    expect(budget.reserve(1)).toBeNull();
  });

  /**
   * TEST_SCENARIO: Two turns start at once. A caller that asked whether bytes fit
   * and charged them afterwards would let both pass the same reading, because the
   * download sits between the question and the answer.
   */
  it("charges a reservation while its bytes are still on the wire", () => {
    const budget = createAttachmentBudget(100);

    budget.reserve(80);
    expect(budget.reserve(80)).toBeNull();
  });

  /**
   * TEST_SCENARIO: A messenger's declared size is the uploading client's claim, and
   * it can understate the file. Those bytes are resident either way, so they are
   * charged and the next admission is the one that pays for it.
   */
  it("settles upward when the real size beat the declaration", () => {
    const budget = createAttachmentBudget(100);
    const claim = budget.reserve(10)!;

    claim.settle(90);

    expect(budget.held()).toBe(90);
    expect(budget.reserve(20)).toBeNull();
  });

  it("keeps bounding after an overrun takes it past the ceiling", () => {
    const budget = createAttachmentBudget(100);
    const claim = budget.reserve(10)!;

    claim.settle(150);

    expect(budget.held()).toBe(150);
    expect(budget.reserve(1)).toBeNull();
    claim.release();
    expect(budget.held()).toBe(0);
    expect(budget.reserve(100)).not.toBeNull();
  });

  it("settles downward when less arrived than was reserved", () => {
    const budget = createAttachmentBudget(100);
    const claim = budget.reserve(100)!;

    claim.settle(10);

    expect(budget.held()).toBe(10);
    expect(budget.reserve(90)).not.toBeNull();
  });

  it("releases once, however many paths call it", () => {
    const budget = createAttachmentBudget(100);
    const claim = budget.reserve(50)!;

    claim.release();
    claim.release();

    expect(budget.held()).toBe(0);
  });

  it("frees the ceiling for the next attachment", () => {
    const budget = createAttachmentBudget(100);
    const first = budget.reserve(100)!;
    expect(budget.reserve(1)).toBeNull();

    first.release();

    expect(budget.reserve(100)).not.toBeNull();
  });

  /**
   * TEST_SCENARIO: A settle arriving after the release — a late branch, a retry —
   * would charge bytes that no longer have an owner, and nothing would ever give
   * them back. The ceiling would shrink for the life of the process.
   */
  it("is inert after release, in either order", () => {
    const budget = createAttachmentBudget(100);
    const claim = budget.reserve(50)!;

    claim.release();
    claim.settle(90);

    expect(budget.held()).toBe(0);
    expect(budget.reserve(100)).not.toBeNull();
  });

  it("keeps two claims independent", () => {
    const budget = createAttachmentBudget(100);
    const a = budget.reserve(30)!;
    const b = budget.reserve(30)!;

    a.settle(50);
    b.release();

    expect(budget.held()).toBe(50);
    a.release();
    expect(budget.held()).toBe(0);
  });

  /**
   * TEST_SCENARIO: NaN passes a `> cap` test and then makes every later comparison
   * false, so a single nonsense reservation would disable the ceiling entirely.
   */
  it("refuses a reservation that is not a size", () => {
    const budget = createAttachmentBudget(100);

    expect(budget.reserve(Number.NaN)).toBeNull();
    expect(budget.reserve(Number.POSITIVE_INFINITY)).toBeNull();
    expect(budget.reserve(-10)).toBeNull();
    expect(budget.held()).toBe(0);
  });

  it("ignores a settlement that is not a size", () => {
    const budget = createAttachmentBudget(100);
    const claim = budget.reserve(40)!;

    claim.settle(Number.NaN);

    expect(budget.held()).toBe(40);
  });

  /**
   * TEST_SCENARIO: A message with no attachments must not be turned away by a full
   * budget — and the claim it gets back must hold nothing, or it could settle into
   * a charge that skipped admission.
   */
  it("never refuses nothing", () => {
    const budget = createAttachmentBudget(10);
    budget.reserve(10);

    const nothing = budget.reserve(0)!;
    expect(nothing).not.toBeNull();

    nothing.settle(80);

    expect(budget.held()).toBe(10);
  });
});
