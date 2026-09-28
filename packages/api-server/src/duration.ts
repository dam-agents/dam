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
