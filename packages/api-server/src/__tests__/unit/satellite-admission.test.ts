import { describe, expect, it } from "vitest";
import type { SatelliteCommand } from "api-server-api";
import {
  admit,
  compileCommands,
  isOnline,
  OFFLINE_AFTER_MS,
} from "../../modules/satellites/domain/admission.js";
import type { SatelliteRow } from "../../modules/satellites/domain/types.js";

/**
 * TEST_OVERVIEW: Admission — whether a start becomes a Job at all. It is
 * deliberately all-or-nothing, because start reports the Job as running and that
 * has to be true: a Job is accepted only when a worker will pick it up within a
 * poll interval, and anything else is refused with a reason the model can act
 * on. The specs cover a command the Manifest permits, one it does not, a
 * Satellite that is offline or draining, the Satellite's own concurrency limit,
 * and a per-command limit that blocks one command while others still start.
 * A command marked approval = always is admitted as pending-approval rather than
 * queued, so a human decides before the machine runs anything.
 */

const NOW = new Date("2026-09-17T12:00:00Z");

const COMMANDS: SatelliteCommand[] = [
  { run: "./process.sh (sales.db|events.db) [-n <count:1-9999>]" },
  { run: "./train.sh <dataset:./data/**/*.db>", maxConcurrent: 1 },
  { run: "git -C /srv/repo (pull|status)", approval: "always" },
];

function satellite(patch: Partial<SatelliteRow> = {}): SatelliteRow {
  return {
    owner: "alice",
    name: "gpu-box",
    description: null,
    host: "gpu-box.internal",
    maxConcurrent: 16,
    commands: COMMANDS,
    draining: false,
    lastSeenAt: new Date(NOW.getTime() - 1000),
    ...patch,
  };
}

function compiled() {
  const result = compileCommands(COMMANDS);
  if (!result.ok) throw new Error(result.error);
  return result.commands;
}

const NO_ACTIVE = { total: 0, byPattern: new Map<string, number>() };

describe("admission", () => {
  it("admits a command the manifest permits", () => {
    const verdict = admit(
      satellite(),
      compiled(),
      ["./process.sh", "sales.db"],
      NO_ACTIVE,
      NOW,
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.status).toBe("queued");
  });

  it("holds a command that asks for approval", () => {
    const verdict = admit(
      satellite(),
      compiled(),
      ["git", "-C", "/srv/repo", "pull"],
      NO_ACTIVE,
      NOW,
    );
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.status).toBe("pending-approval");
  });

  it("refuses a command no pattern permits, and says what came closest", () => {
    const verdict = admit(
      satellite(),
      compiled(),
      ["./process.sh", "/etc/shadow"],
      NO_ACTIVE,
      NOW,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("./process.sh");
  });

  it("refuses while the satellite is offline rather than queueing", () => {
    const stale = satellite({
      lastSeenAt: new Date(NOW.getTime() - OFFLINE_AFTER_MS - 1),
    });
    const verdict = admit(
      stale,
      compiled(),
      ["./process.sh", "sales.db"],
      NO_ACTIVE,
      NOW,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("offline");
  });

  it("refuses while draining", () => {
    const verdict = admit(
      satellite({ draining: true }),
      compiled(),
      ["./process.sh", "sales.db"],
      NO_ACTIVE,
      NOW,
    );
    expect(verdict.ok).toBe(false);
  });

  it("refuses at the satellite's concurrency limit", () => {
    const verdict = admit(
      satellite({ maxConcurrent: 2 }),
      compiled(),
      ["./process.sh", "sales.db"],
      { total: 2, byPattern: new Map() },
      NOW,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("max 2");
  });

  it("refuses at a command's own limit while others still run", () => {
    const active = {
      total: 1,
      byPattern: new Map([["./train.sh <dataset:./data/**/*.db>", 1]]),
    };
    const exclusive = admit(
      satellite(),
      compiled(),
      ["./train.sh", "./data/a.db"],
      active,
      NOW,
    );
    expect(exclusive.ok).toBe(false);

    const other = admit(
      satellite(),
      compiled(),
      ["./process.sh", "sales.db"],
      active,
      NOW,
    );
    expect(other.ok).toBe(true);
  });

  it("refuses a manifest whose patterns do not parse", () => {
    const broken = compileCommands([{ run: "<anything>" }]);
    expect(broken.ok).toBe(false);
  });
});

describe("online", () => {
  it("needs a heartbeat inside the window", () => {
    expect(isOnline(satellite(), NOW)).toBe(true);
    expect(isOnline(satellite({ lastSeenAt: null }), NOW)).toBe(false);
    expect(
      isOnline(
        satellite({ lastSeenAt: new Date(NOW.getTime() - OFFLINE_AFTER_MS) }),
        NOW,
      ),
    ).toBe(false);
  });
});
