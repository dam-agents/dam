import { ALL_DAYS, quietWindowSchema } from "api-server-api";
import type { FrequencyPreset, QuietWindow } from "api-server-api";

// Pure flag parsers for the `dam schedule` recurrence surface. Each throws a
// descriptive Error on bad input; the calling command catches and exits
// EXIT_INVALID_INPUT. The compiled preset is handed to the shared `buildRRule`
// (api-server-api) — the CLI never assembles an RRULE body itself.

const WEEKDAY_TO_ISO: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

const ISO_TO_WEEKDAY: Record<number, string> = {
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
  7: "SU",
};

/** ISO [1,3,5] → "MO,WE,FR". Inverse of parseWeekdays, for the update drop note. */
export function formatWeekdays(days: number[]): string {
  return days
    .map((d) => ISO_TO_WEEKDAY[d])
    .filter((t): t is string => t !== undefined)
    .join(",");
}

/** "MO,WE,FR" → ISO [1,3,5]. Unknown token throws. */
export function parseWeekdays(s: string): number[] {
  const tokens = s
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new Error("--weekdays needs at least one of MO,TU,WE,TH,FR,SA,SU");
  }
  const days: number[] = [];
  for (const tok of tokens) {
    const iso = WEEKDAY_TO_ISO[tok];
    if (iso === undefined) {
      throw new Error(`unknown weekday "${tok}" — use MO,TU,WE,TH,FR,SA,SU`);
    }
    if (!days.includes(iso)) days.push(iso);
  }
  days.sort((a, b) => a - b);
  return days;
}

/** "30m" → minutely/30, "2h" → hourly/2. Rejects zero/negative/other units. */
export function parseEvery(s: string): {
  kind: "minutely" | "hourly";
  interval: number;
} {
  const m = /^(\d+)(m|h)$/.exec(s.trim());
  if (!m) {
    throw new Error(`--every must be <N>m or <N>h (e.g. 30m, 2h), got "${s}"`);
  }
  const interval = Number(m[1]);
  if (interval < 1) {
    throw new Error(`--every interval must be a positive integer, got "${s}"`);
  }
  return { kind: m[2] === "m" ? "minutely" : "hourly", interval };
}

/** "07:30" → { hour: 7, minute: 30 }. Validates 00:00–23:59. */
export function parseDaily(s: string): { hour: number; minute: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`--daily must be HH:MM (24h), got "${s}"`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`--daily must be a valid 24h time 00:00–23:59, got "${s}"`);
  }
  return { hour, minute };
}

/**
 * Enforce exactly one of --daily / --every / --rrule and compile it to a
 * shared `FrequencyPreset`. `--weekdays` is a BYDAY filter on --daily/--every
 * and is rejected with --rrule (a raw body carries its own BYDAY).
 */
export function buildPresetFromFlags(opts: {
  daily?: string;
  every?: string;
  rrule?: string;
  weekdays?: string;
}): FrequencyPreset {
  const chosen = [opts.daily, opts.every, opts.rrule].filter(
    (v) => v !== undefined,
  );
  if (chosen.length === 0) {
    throw new Error(
      "a recurrence is required — pass exactly one of --daily, --every, or --rrule",
    );
  }
  if (chosen.length > 1) {
    throw new Error(
      "--daily, --every, and --rrule are mutually exclusive — pass exactly one",
    );
  }

  if (opts.rrule !== undefined) {
    if (opts.weekdays !== undefined) {
      throw new Error(
        "--weekdays cannot combine with --rrule (the raw RRULE body carries its own BYDAY)",
      );
    }
    return { kind: "custom", rrule: opts.rrule };
  }

  const days =
    opts.weekdays !== undefined ? parseWeekdays(opts.weekdays) : [...ALL_DAYS];

  if (opts.every !== undefined) {
    const { kind, interval } = parseEvery(opts.every);
    return { kind, interval, days };
  }

  const { hour, minute } = parseDaily(opts.daily as string);
  return { kind: "daily", hour, minute, days };
}

/** "22:00-06:00" → { startTime, endTime, enabled: true }. Validates each side
 *  and the start ≠ end rule through the contract's `quietWindowSchema`. */
export function parseQuietWindow(s: string): QuietWindow {
  const parts = s.split("-");
  if (parts.length !== 2) {
    throw new Error(
      `--quiet-window must be HH:MM-HH:MM (e.g. 22:00-06:00), got "${s}"`,
    );
  }
  const parsed = quietWindowSchema.safeParse({
    startTime: parts[0]?.trim(),
    endTime: parts[1]?.trim(),
    enabled: true,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "invalid quiet window";
    throw new Error(`--quiet-window "${s}": ${msg}`);
  }
  return parsed.data;
}
