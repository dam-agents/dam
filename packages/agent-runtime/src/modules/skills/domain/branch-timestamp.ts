// UNIT_BOUNDARY_DESCRIPTION: an ISO string is already this stamp in another punctuation, and it is already UTC — so the digits of one are the digits of the other, in the same order. Said with date-fns-tz instead, this line costs 1.5 s of every agent's startup: the package pulls date-fns whole, all thousand functions and every locale, to format fourteen characters.
export function branchTimestamp(now: Date): string {
  return now.toISOString().replace(/\D/g, "").slice(0, 14);
}
