export type Bucket =
  | "Today"
  | "Yesterday"
  | "Last 7 days"
  | "Last 30 days"
  | "Older";

export const BUCKET_ORDER: readonly Bucket[] = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 30 days",
  "Older",
];

function localMidnight(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function bucketOf(
  isoDate: string | null,
  now: Date = new Date(),
): Bucket {
  if (!isoDate) return "Older";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "Older";

  const todayStart = localMidnight(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(todayStart);
  monthStart.setDate(monthStart.getDate() - 29);

  if (d >= todayStart) return "Today";
  if (d >= yesterdayStart) return "Yesterday";
  if (d >= weekStart) return "Last 7 days";
  if (d >= monthStart) return "Last 30 days";
  return "Older";
}

export interface BucketedItems<T> {
  bucket: Bucket;
  items: T[];
}

export function bucketItems<T>(
  items: readonly T[],
  getDate: (item: T) => string | null,
  now?: Date,
): BucketedItems<T>[] {
  const groups = new Map<Bucket, T[]>();
  for (const item of items) {
    const b = bucketOf(getDate(item), now);
    let arr = groups.get(b);
    if (!arr) {
      arr = [];
      groups.set(b, arr);
    }
    arr.push(item);
  }
  return BUCKET_ORDER.filter((b) => groups.has(b)).map((b) => ({
    bucket: b,
    items: groups.get(b)!,
  }));
}
