// TEST_OVERVIEW: The repeat limits on resource alert messages. Storage sends once per rise past the level last told, at most once a day except one escalation from high (90%) to full (98%), holds its level between 80% and 90%, and re-arms below 80%. A runner out-of-memory episode sends once, re-arms when no agent is affected, and sends again only six hours after the last message.
import { describe, expect, it } from "vitest";

import {
  type AlertMark,
  CLEAR_MARK,
  nextOom,
  nextStorage,
} from "../../modules/resource-alerts/domain/alert-policy.js";

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-10-13T00:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

function storageSends(...readings: [number, number][]): boolean[] {
  let mark: AlertMark = CLEAR_MARK;
  return readings.map(([percent, hours]) => {
    const step = nextStorage(mark, percent, at(hours));
    mark = step.mark;
    return step.send;
  });
}

function oomSends(...looks: [number, number][]): boolean[] {
  let mark: AlertMark = CLEAR_MARK;
  return looks.map(([affected, hours]) => {
    const step = nextOom(mark, affected, at(hours));
    mark = step.mark;
    return step.send;
  });
}

describe("storage alerts", () => {
  it("sends once when the pool passes 90%, and not while it hovers", () => {
    expect(storageSends([91, 0], [92, 1], [89, 2], [91, 3])).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  // TEST_SCENARIO: An owner who frees space and fills it again the same day is not messaged twice in a day; the rise that was held back goes out once the day has passed.
  it("re-arms below 80% but keeps to one message a day", () => {
    expect(storageSends([91, 0], [79, 1], [91, 2], [91, 25])).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  // TEST_SCENARIO: Full means writes are failing, so the escalation from high to full is worth a second message inside the day, but only one.
  it("lets one escalation to full through inside the day", () => {
    expect(storageSends([91, 0], [98, 1], [70, 2], [91, 3], [99, 4])).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("sends nothing below 90%", () => {
    expect(storageSends([75, 0], [89, 1])).toEqual([false, false]);
  });
});

describe("runner out-of-memory alerts", () => {
  it("sends one message per episode", () => {
    expect(oomSends([2, 0], [3, 0.1], [0, 0.2])).toEqual([true, false, false]);
  });

  // TEST_SCENARIO: A runner killed again soon after its agents recovered is a crash loop the owner already heard about, so the next episode within six hours sends nothing; one after that sends again.
  it("waits six hours between messages", () => {
    expect(oomSends([1, 0], [0, 1], [1, 2], [0, 3], [1, 7])).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
  });
});
