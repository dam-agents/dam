// TEST_OVERVIEW: the assistant-schedules repository writes a report's items and its time in one update. postgres.js takes a time only as text, and drizzle turns a Date into text only where it binds it to a column, not inside raw `sql`; an update that keeps the earlier time builds its value in raw `sql`, so it must hand the driver text itself. These specs run the real repository on drizzle's proxy driver and read what it would send to Postgres.
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import type { Db } from "db";

import { createAssistantSchedulesRepository } from "../../modules/assistant-schedules/infrastructure/assistant-schedules-repository.js";

const AT = new Date("2026-11-28T03:27:02.000Z");

function capturingDb() {
  const sent: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(async (sql, params) => {
    sent.push({ sql, params });
    return { rows: [] };
  }) as unknown as Db;
  return { db, sent };
}

describe("assistant schedules repository report", () => {
  // TEST_SCENARIO: an alert that updates the one before it keeps that one's time; the time goes into a coalesce, raw sql, and a Date there made postgres.js throw and the report a 500 (#6919).
  it("sends the driver no Date when it keeps the earlier time", async () => {
    const { db, sent } = capturingDb();
    await createAssistantSchedulesRepository(db).report(
      "owner-1",
      "security-check",
      ["an item"],
      { at: AT, keepTime: true },
    );

    expect(sent).toHaveLength(1);
    const [{ sql, params }] = sent as [(typeof sent)[number]];
    expect(sql).toMatch(/coalesce\("assistant_schedules"\."reported_at", /);
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain(AT.toISOString());
  });

  // TEST_SCENARIO: a new alert takes the time of its own report.
  it("sends the driver no Date when it sets the time", async () => {
    const { db, sent } = capturingDb();
    await createAssistantSchedulesRepository(db).report(
      "owner-1",
      "security-check",
      ["an item"],
      { at: AT, keepTime: false },
    );

    expect(sent).toHaveLength(1);
    const [{ sql, params }] = sent as [(typeof sent)[number]];
    expect(sql).not.toMatch(/coalesce/);
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain(AT.toISOString());
  });
});
