import { activityEvents, lt, sql, type Db } from "db";

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
