import { activityEvents, lt, sql, type Db } from "db";

/** Bulk-deletes `activity_events` older than the cutoff. Returns row count
 *  so the caller can log it. Indexes survive — autovacuum reclaims pages
 *  on its own cadence; no manual VACUUM. */
export function deleteActivityEventsOlderThan(db: Db) {
  return async (days: number): Promise<number> => {
    const result = await db
      .delete(activityEvents)
      .where(
        lt(
          activityEvents.occurredAt,
          sql`now() - make_interval(days => ${days})`,
        ),
      );
    return (result as unknown as { rowCount?: number }).rowCount ?? 0;
  };
}
