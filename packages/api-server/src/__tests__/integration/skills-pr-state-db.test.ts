/**
 * The pr-state SQL seam, exercised against a real PostgreSQL through the real
 * driver stack. Both production bugs in this seam were invisible to unit
 * tests (which mock the repository) and to a bare postgres-js client:
 *
 *  - a `Date` interpolated into a raw sql`` template throws at Bind — but
 *    only under drizzle, whose postgres-js driver replaces the client's date
 *    serializers with pass-throughs at construction;
 *  - `power(2, failures)` is double precision and overflows at 2^1024,
 *    failing the whole candidate query for every row.
 *
 * So these tests MUST build the repository over `drizzle(postgres(url))` —
 * the `createDb` path production uses — or they reproduce the false negative.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, runMigrations, agentSkillPublishes, type Db } from "db";
import {
  createAgentSkillsRepository,
  type AgentSkillsRepository,
} from "../../modules/skills/infrastructure/agent-skills-repository.js";

const CONTAINER = `pr-state-db-test-${process.pid}`;
const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../db/drizzle",
);

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: Db;
let end: () => Promise<void>;
let repo: AgentSkillsRepository;

beforeAll(async () => {
  docker(
    "run",
    "-d",
    "--rm",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_PASSWORD=test",
    "-e",
    "POSTGRES_DB=test",
    "-p",
    "127.0.0.1::5432",
    "postgres:18-alpine",
  );
  for (let i = 0; ; i++) {
    try {
      docker("exec", CONTAINER, "pg_isready", "-U", "postgres", "-d", "test");
      break;
    } catch {
      if (i > 120) throw new Error("postgres container never became ready");
      await sleep(500);
    }
  }
  const hostPort = docker("port", CONTAINER, "5432/tcp").split("\n")[0];
  const url = `postgres://postgres:test@${hostPort}/test`;
  // Real migrations, so migration files themselves are exercised too. Retried
  // because the stock postgres image starts the server once for init and then
  // restarts it — pg_isready can pass in the gap, so the first real
  // connection, not the probe, is the ground truth. Safe to retry: drizzle
  // applies the migration set in one transaction.
  let lastErr: unknown = new Error("unreachable");
  for (let i = 0; i < 60; i++) {
    try {
      await runMigrations(url, MIGRATIONS);
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  if (lastErr !== undefined) throw lastErr;
  const handle = createDb(url);
  db = handle.db;
  end = () => handle.sql.end();
  repo = createAgentSkillsRepository(db);
});

afterAll(async () => {
  await end?.();
  try {
    docker("rm", "-f", CONTAINER);
  } catch {
    // --rm already reaped it.
  }
});

beforeEach(async () => {
  await db.delete(agentSkillPublishes);
});

const NOW = new Date("2026-08-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const url = (n: number) => `https://github.com/acme/skills/pull/${n}`;

let seq = 0;
async function seed(row: {
  agentId?: string;
  prUrl?: string;
  prState?: string | null;
  checkedAt?: Date | null;
  failures?: number;
  needsPod?: boolean;
  etag?: string | null;
}): Promise<string> {
  seq += 1;
  const prUrl = row.prUrl ?? url(seq);
  await db.insert(agentSkillPublishes).values({
    id: `pub-${seq}`,
    agentId: row.agentId ?? "a1",
    skillName: "s",
    sourceId: "src-1",
    sourceName: "Acme Skills",
    sourceGitUrl: "https://github.com/acme/skills.git",
    prUrl,
    publishedAt: hoursAgo(72),
    prState: row.prState ?? null,
    prStateCheckedAt: row.checkedAt ?? null,
    prStateCheckFailures: row.failures ?? 0,
    prNeedsPod: row.needsPod ?? false,
    prEtag: row.etag ?? null,
  });
  return prUrl;
}

async function anonymousUrls(): Promise<string[]> {
  const rows = await repo.listPrStateCandidates(NOW, 50);
  return rows.map((r) => r.prUrl);
}

describe("listPrStateCandidates (anonymous lane)", () => {
  it("selects due records through the real driver stack", async () => {
    // The exact population whose candidate query silently died on main: a
    // fresh publish, an hourly record past due, and a backed-off failure.
    const fresh = await seed({ checkedAt: null });
    const due = await seed({ prState: "open", checkedAt: hoursAgo(2) });
    const backedOff = await seed({ checkedAt: hoursAgo(200), failures: 7 });
    const notDue = await seed({ prState: "open", checkedAt: hoursAgo(0.5) });

    const got = await anonymousUrls();
    expect(got).toContain(fresh);
    expect(got).toContain(due);
    expect(got).toContain(backedOff);
    expect(got).not.toContain(notDue);
  });

  it("orders never-attempted records first, then oldest attempt", async () => {
    const old = await seed({ checkedAt: hoursAgo(5) });
    const older = await seed({ checkedAt: hoursAgo(9) });
    const fresh = await seed({ checkedAt: null });

    expect(await anonymousUrls()).toEqual([fresh, older, old]);
  });

  it("doubles the wait per consecutive failure", async () => {
    // failures=1 → 2h wait: due at 3h, not at 1h.
    const due = await seed({ checkedAt: hoursAgo(3), failures: 1 });
    const notDue = await seed({ checkedAt: hoursAgo(1), failures: 1 });

    const got = await anonymousUrls();
    expect(got).toContain(due);
    expect(got).not.toContain(notDue);
  });

  it("caps the backoff at a day", async () => {
    // failures≥5 hit the 24h cap: due at 25h, not at 23h.
    const due = await seed({ checkedAt: hoursAgo(25), failures: 29 });
    const notDue = await seed({ checkedAt: hoursAgo(23), failures: 29 });

    const got = await anonymousUrls();
    expect(got).toContain(due);
    expect(got).not.toContain(notDue);
  });

  it("retires records at the failure bound", async () => {
    const retired = await seed({ checkedAt: hoursAgo(9000), failures: 30 });

    expect(await anonymousUrls()).not.toContain(retired);
  });

  it("survives a poisoned failure count that would overflow power()", async () => {
    // 2^1024 overflows double precision; the WHERE has no evaluation-order
    // guarantee, so the retirement bound alone cannot shield the expression.
    await seed({ checkedAt: hoursAgo(5), failures: 2000 });
    const healthy = await seed({ prState: "open", checkedAt: hoursAgo(2) });

    expect(await anonymousUrls()).toEqual([healthy]);
  });

  it("excludes terminal and pod-lane records", async () => {
    await seed({ prState: "merged", checkedAt: hoursAgo(50) });
    await seed({ prState: "closed", checkedAt: hoursAgo(50) });
    await seed({ checkedAt: hoursAgo(50), needsPod: true });
    const draft = await seed({ prState: "draft", checkedAt: hoursAgo(2) });

    expect(await anonymousUrls()).toEqual([draft]);
  });
});

describe("listPodPrStateCandidates (pod lane)", () => {
  it("selects only marked records, under the same backoff and retirement", async () => {
    await seed({ checkedAt: hoursAgo(2) }); // anonymous lane
    const due = await seed({ checkedAt: hoursAgo(2), needsPod: true });
    await seed({ checkedAt: hoursAgo(0.5), needsPod: true }); // not due
    await seed({ checkedAt: hoursAgo(9000), needsPod: true, failures: 30 }); // retired
    await seed({ prState: "merged", checkedAt: hoursAgo(50), needsPod: true });

    const rows = await repo.listPodPrStateCandidates(NOW, 50);
    expect(rows).toEqual([{ agentId: "a1", prUrl: due }]);
  });
});

describe("write paths", () => {
  it("touchPrState(failed) grows the counter and discards the validator", async () => {
    const prUrl = await seed({ failures: 2, etag: "e1" });

    await repo.touchPrState(prUrl, NOW, "failed");

    const [row] = await db.select().from(agentSkillPublishes);
    expect(row.prStateCheckFailures).toBe(3);
    expect(row.prEtag).toBeNull();
    expect(row.prStateCheckedAt).toEqual(NOW);
  });

  it("touchPrState(confirmed) resets the counter and keeps the validator", async () => {
    const prUrl = await seed({ failures: 2, etag: "e1" });

    await repo.touchPrState(prUrl, NOW, "confirmed");

    const [row] = await db.select().from(agentSkillPublishes);
    expect(row.prStateCheckFailures).toBe(0);
    expect(row.prEtag).toBe("e1");
  });

  it("setPrState settles every record of the pull request and resets the counter", async () => {
    const prUrl = await seed({ agentId: "a1", failures: 4 });
    await seed({ agentId: "a2", prUrl, failures: 4 });

    await repo.setPrState(prUrl, {
      prState: "merged",
      checkedAt: NOW,
      etag: null,
    });

    const rows = await db.select().from(agentSkillPublishes);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.prState).toBe("merged");
      expect(row.prStateCheckFailures).toBe(0);
    }
  });

  it("markPrNeedsPod flags every record of the pull request and discards the validator", async () => {
    const prUrl = await seed({ agentId: "a1", etag: "e1" });
    await seed({ agentId: "a2", prUrl, etag: "e1" });

    await repo.markPrNeedsPod(prUrl);

    const rows = await db.select().from(agentSkillPublishes);
    for (const row of rows) {
      expect(row.prNeedsPod).toBe(true);
      expect(row.prEtag).toBeNull();
    }
  });
});
