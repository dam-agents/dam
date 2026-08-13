import { describe, expect, it } from "vitest";

import {
  createAttachmentBudget,
  encodedFootprint,
  stagedFootprint,
} from "../../modules/channels/attachment-budget.js";

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

  it("charges a reservation while its bytes are still on the wire", () => {
    // The point of reserving at admission: a second caller sees the first's
    // bytes before they have arrived, which a check-then-charge gate cannot do.
    const budget = createAttachmentBudget(100);

    budget.reserve(80);
    expect(budget.reserve(80)).toBeNull();
  });

  it("settles upward when the real size beat the declaration", () => {
    // A messenger's declared size is the uploading client's claim. When it
    // understates the file, the bytes are resident either way — so they are
    // charged, and the next admission is the one that pays for it.
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
    // And the overrun is fully given back, not just the reservation.
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
    // A refusal branch and the owning turn's `finally` may both run.
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

  it("is inert after release, in either order", () => {
    // A released claim's bytes have no owner, so nothing may charge them again —
    // otherwise a settle arriving late shrinks the ceiling for the process's life.
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

  it("refuses a reservation that is not a size", () => {
    // NaN would pass a `> cap` test and then make every later one false.
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

  it("never refuses nothing", () => {
    const budget = createAttachmentBudget(10);
    budget.reserve(10);

    // A message with no attachments must not be turned away by a full budget —
    // and the claim it gets back holds nothing, so it cannot settle into a charge
    // that skipped admission.
    const nothing = budget.reserve(0)!;
    expect(nothing).not.toBeNull();

    nothing.settle(80);

    expect(budget.held()).toBe(10);
  });
});
