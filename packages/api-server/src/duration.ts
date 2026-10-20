const DURATION_TOKEN = String.raw`(\d+(?:\.\d+)?)(ms|h|m|s)`;

export function durationToMinutes(d: string): number {
  let ms = 0;
  for (const [, n, unit] of d.matchAll(new RegExp(DURATION_TOKEN, "g"))) {
    const mult =
      unit === "h" ? 3600000 : unit === "m" ? 60000 : unit === "s" ? 1000 : 1;
    ms += parseFloat(n) * mult;
  }
  return ms === 0 ? 0 : Math.max(1, Math.round(ms / 60000));
}

export function durationToMinutesStrict(d: string): number {
  if (!new RegExp(`^(?:${DURATION_TOKEN})+$`).test(d.trim()))
    throw new Error(`not a valid duration: "${d}"`);
  return durationToMinutes(d);
}

export function minutesToDuration(min: number): string {
  return min === 0 ? "0s" : `${min}m`;
}

const GO_DURATION_UNITS_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  ms: 1,
  s: 1e3,
  m: 60e3,
  h: 3600e3,
};

// UNIT_BOUNDARY_DESCRIPTION: a per-Agent override, read the way the controller reads it. The field holds a Go duration, so it accepts units the minute parser never sees (`1ns`, `1500ms`), and a duration the controller treats as a positive timeout must not project to zero minutes here: zero is what the platform reads as never-hibernate. A positive duration under a minute therefore projects to one minute. A value that is not a Go duration is null, so a caller whose Agent can only carry a valid one inherits the default rather than reading it as never-hibernate.
export function goDurationToMinutes(d: string): number | null {
  const ms = goDurationMs(d);
  if (ms === null) return null;
  return ms === 0 ? 0 : Math.max(1, Math.round(ms / 60000));
}

// UNIT_BOUNDARY_DESCRIPTION: a chart value the controller reads as a Go duration, such as 168h or 72h30m, read into milliseconds the same way. Anything it cannot read is null, so a caller that only shows the value can say it is unknown rather than show a wrong one.
export function goDurationMs(raw: string): number | null {
  const text = raw.trim();
  if (text === "0") return 0;
  const part = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/gy;
  let total = 0;
  let at = 0;
  for (const m of text.matchAll(part)) {
    total += Number(m[1]) * (GO_DURATION_UNITS_MS[m[2] ?? ""] ?? 0);
    at = (m.index ?? 0) + m[0].length;
  }
  return at > 0 && at === text.length ? total : null;
}
