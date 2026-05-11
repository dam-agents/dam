import { describe, expect, it } from "vitest";
import {
  isExpired,
  isWithinRefreshBuffer,
  type HostAuth,
} from "../modules/auth/domain/host-auth.js";

function host(expiresAt: Date): HostAuth {
  return {
    issuer: "https://idp.example",
    username: "petr",
    sub: "abc",
    accessToken: "a",
    refreshToken: "r",
    expiresAt,
  };
}

const NOW = new Date("2026-01-01T00:00:00Z");

describe("isExpired", () => {
  it.each([
    { label: "past", offsetMs: -1, expected: true },
    { label: "exactly now", offsetMs: 0, expected: true },
    { label: "future", offsetMs: 60_000, expected: false },
  ])("$label → $expected", ({ offsetMs, expected }) => {
    const h = host(new Date(NOW.getTime() + offsetMs));
    expect(isExpired(h, NOW)).toBe(expected);
  });
});

describe("isWithinRefreshBuffer (60s)", () => {
  it.each([
    { label: "30s away (inside buffer)", offsetMs: 30_000, expected: true },
    { label: "exactly 60s away (on boundary)", offsetMs: 60_000, expected: true },
    { label: "90s away (outside buffer)", offsetMs: 90_000, expected: false },
    { label: "already expired", offsetMs: -10_000, expected: true },
  ])("$label → $expected", ({ offsetMs, expected }) => {
    const h = host(new Date(NOW.getTime() + offsetMs));
    expect(isWithinRefreshBuffer(h, NOW, 60)).toBe(expected);
  });
});
