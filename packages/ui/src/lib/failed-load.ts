// UNIT_BOUNDARY_DESCRIPTION: a read that failed and has no data yet stays failed while a retry runs. React Query resets an uncached query from error to pending when it retries, so isError alone would drop the retry control mid-retry; the time of the last error stays set until the query has data.
export function failedLoad(query: {
  data: unknown;
  errorUpdatedAt: number;
}): boolean {
  return query.data === undefined && query.errorUpdatedAt > 0;
}
