import { describe, expect, it } from "vitest";
import type { SatelliteCommand } from "api-server-api";
import {
  admit,
  compileCommands,
  isOnline,
  OFFLINE_AFTER_MS,
} from "../../modules/satellites/domain/admission.js";
import type { SatelliteRow } from "../../modules/satellites/domain/types.js";
import { createSatelliteWorkerOps } from "../../modules/satellites/services/worker-ops.js";
import { composeSatellitesModule } from "../../modules/satellites/compose.js";

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
  { run: "./process.sh (sales.db|events.db) [-n ^[1-9][0-9]{0,3}$]" },
  { run: "./train.sh ./data/**/*.db", maxConcurrent: 1 },
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
      byPattern: new Map([["./train.sh ./data/**/*.db", 1]]),
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
    const broken = compileCommands([{ run: "*" }]);
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

describe("draining", () => {
  it("survives a heartbeat, and ends when the machine claims again", async () => {
    const calls: string[] = [];
    const repo = {
      get: async () => satellite({ draining: true }),
      touch: async () => {
        calls.push("touch");
      },
      setDraining: async (_o: string, _n: string, value: boolean) => {
        calls.push(`setDraining:${value}`);
      },
      renewLeases: async () => {},
      claimQueued: async () => [],
      takeCancellations: async () => [],
    };
    const ops = createSatelliteWorkerOps({
      repo: repo as never,
      maxConcurrentCeiling: 64,
      deliverOutcome: async () => {},
    });

    await ops.heartbeat("alice", { satellite: "gpu-box", running: [] });
    expect(
      calls,
      "a machine that is shutting down must not un-shut itself on its own beat",
    ).toEqual(["touch"]);

    await ops.claim("alice", { satellite: "gpu-box", capacity: 4, waitMs: 0 });
    expect(
      calls,
      "but a draining worker stops claiming, so a claim means it is serving again",
    ).toContain("setDraining:false");

    await ops.drain("alice", "gpu-box");
    expect(calls).toContain("setDraining:true");
  });
});

describe("an approval that nobody answers", () => {
  it("settles its job, so the hold does not outlive the approval", async () => {
    const settled: { status: string; reason?: string }[] = [];
    const delivered: string[] = [];
    const composition = composeSatellitesModule({
      db: {} as never,
      maxConcurrentCeiling: 64,
      ownerOf: async () => "alice",
      isAgentOwnedBy: async () => true,
      requestApproval: async () => "appr-1",
      spillLog: async () => null,
      deliverOutcome: async ({ satellite, sequence }) => {
        delivered.push(`${satellite}#${sequence}`);
      },
    });
    (composition.repo as unknown as Record<string, unknown>).settle = async (
      _o: string,
      _s: string,
      _seq: number,
      patch: { status: string; reason?: string },
    ) => {
      settled.push(patch);
      return { agentId: "agent-1" };
    };

    await composition.applyVerdict(
      "alice",
      "gpu-box",
      7,
      false,
      "nobody answered the approval before it expired",
    );

    expect(settled[0]?.status).toBe("cancelled");
    expect(settled[0]?.reason).toContain("expired");
    expect(
      delivered,
      "the agent is told, as with any terminal outcome",
    ).toEqual(["gpu-box#7"]);
  });
});
