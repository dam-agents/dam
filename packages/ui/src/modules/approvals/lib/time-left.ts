const pad = (value: number): string => String(value).padStart(2, "0");

// UNIT_BOUNDARY_DESCRIPTION: the time a held call has left before the api-server refuses it, counted from the approval's `expiresAt`, as "4:12" or, for a hold of an hour or more, "1:04:12". Null once the time is up, so the card shows no clock on a call that is already refused.
export function timeLeftText(expiresAt: string, now: Date): string | null {
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (!(left > 0)) return null;
  const seconds = Math.ceil(left / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds % 60)}`
    : `${String(minutes)}:${pad(seconds % 60)}`;
}
