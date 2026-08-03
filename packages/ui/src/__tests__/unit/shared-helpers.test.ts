import { afterEach, describe, expect, test, vi } from "vitest";

import { getErrorMessage } from "../../lib/errors.js";
import { formatBytes } from "../../lib/format-size.js";
import {
  formatDate,
  formatTimestamp,
  largestUnit,
  timeAgo,
  timeUntil,
} from "../../lib/format-time.js";

const MIN = 60_000;
const HR = 3_600_000;
const DAY = 86_400_000;

describe("largestUnit", () => {
  test("picks the largest whole unit, glued", () => {
    expect(largestUnit(3 * DAY + 5 * HR)).toBe("3d");
    expect(largestUnit(2 * HR)).toBe("2h");
    expect(largestUnit(5 * MIN)).toBe("5m");
  });
  test("sub-minute is 'moments'", () => {
    expect(largestUnit(30_000)).toBe("moments");
  });
});

describe("timeAgo", () => {
  afterEach(() => vi.useRealTimers());
  test("past distances, 'just now' under a minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    expect(timeAgo("2026-01-01T11:59:30Z")).toBe("just now");
    expect(timeAgo("2026-01-01T11:55:00Z")).toBe("5m ago");
    expect(timeAgo("2026-01-01T10:00:00Z")).toBe("2h ago");
    expect(timeAgo("2025-12-29T12:00:00Z")).toBe("3d ago");
  });
});

describe("timeUntil", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  test("future distances, spaced units, rounds", () => {
    expect(timeUntil("2026-01-01T11:00:00Z", now)).toBe("due");
    expect(timeUntil("2026-01-01T12:00:20Z", now)).toBe("< 1 min");
    expect(timeUntil("2026-01-01T12:03:00Z", now)).toBe("in 3 min");
    expect(timeUntil("2026-01-01T14:00:00Z", now)).toBe("in 2 h");
    expect(timeUntil("2026-01-06T12:00:00Z", now)).toBe("in 5 d");
  });
  test("unparseable dates degrade to an em dash, not NaN/moments", () => {
    expect(timeUntil("not-a-date", now)).toBe("—");
    expect(timeAgo("not-a-date")).toBe("—");
  });
});

describe("formatTimestamp / formatDate", () => {
  test("invalid or absent dates are an em dash, not Invalid Date or 1970", () => {
    expect(formatTimestamp("not-a-date")).toBe("—");
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});

describe("formatBytes", () => {
  test("base 1024, rounded KB, one-decimal MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
  });
});

describe("getErrorMessage", () => {
  test("Error and message-bearing objects", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage({ code: -1, message: "rpc failed" })).toBe(
      "rpc failed",
    );
  });
  test("fallback wins for shapes without a message", () => {
    expect(getErrorMessage("oops", "Upload failed")).toBe("Upload failed");
    expect(getErrorMessage(undefined, "Save failed")).toBe("Save failed");
  });
  test("an empty-message Error falls back rather than returning ''", () => {
    expect(getErrorMessage(new Error(""), "Delete failed")).toBe(
      "Delete failed",
    );
  });
  test("a supplied fallback beats a generic transport line", () => {
    expect(getErrorMessage(new Event("error"), "Save failed")).toBe(
      "Save failed",
    );
  });
  test("an empty-string fallback is honoured, not treated as absent", () => {
    // The shared mutation onError passes "" to mean "a real message or nothing"
    // so the toast degrades to its bare title — it must not leak String(e).
    expect(getErrorMessage({}, "")).toBe("");
    expect(getErrorMessage(new Error(""), "")).toBe("");
    expect(getErrorMessage(new Event("error"), "")).toBe("");
  });
  test("without a fallback, the transport line describes the failure", () => {
    expect(getErrorMessage(new Event("error"))).toBe("Connection error");
  });
  test("no fallback stringifies the unknown", () => {
    expect(getErrorMessage("bare string")).toBe("bare string");
  });
});
