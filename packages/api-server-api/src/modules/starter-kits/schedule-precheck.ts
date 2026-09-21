export function resolveKitSchedulePrecheck(
  declared: string | undefined,
  override: string | null | undefined,
): string | undefined {
  if (override === null) return undefined;
  return override ?? declared;
}
