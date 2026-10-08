const AT_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/;

export function parseAtFlag(value: string): string {
  const m = AT_PATTERN.exec(value.trim());
  if (!m) throw new Error(`--at must be "YYYY-MM-DD HH:MM", got "${value}"`);
  return `${m[1]}T${m[2]}:${m[3]}`;
}

export function localTimeIn(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const f = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${f.year}-${f.month}-${f.day} ${f.hour}:${f.minute}`;
}

export function recurringFlagsGiven(opts: {
  daily?: string;
  every?: string;
  rrule?: string;
  weekdays?: string;
  quietWindow: string[];
  sessionMode?: string;
  precheck?: string;
  precheckNone?: boolean;
}): string[] {
  return [
    opts.daily !== undefined && "--daily",
    opts.every !== undefined && "--every",
    opts.rrule !== undefined && "--rrule",
    opts.weekdays !== undefined && "--weekdays",
    opts.quietWindow.length > 0 && "--quiet-window",
    opts.sessionMode !== undefined && "--session-mode",
    opts.precheck !== undefined && "--precheck",
    opts.precheckNone === true && "--precheck-none",
  ].filter((f): f is string => typeof f === "string");
}
