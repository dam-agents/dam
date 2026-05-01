import { formatInTimeZone } from "date-fns-tz";

export function branchTimestamp(now: Date): string {
  return formatInTimeZone(now, "UTC", "yyyyMMddHHmmss");
}
