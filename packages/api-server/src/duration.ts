// Conversions between Go duration strings (the CR / chart wire format) and whole minutes (the UI/API unit).

const DURATION_TOKEN = String.raw`(\d+(?:\.\d+)?)(ms|h|m|s)`;

// Parse a Go duration string ("1h", "30m", "0s") to whole minutes. Any positive duration rounds up to at least 1, so it is never mistaken for 0 (= never hibernate).
export function durationToMinutes(d: string): number {
  let ms = 0;
  for (const [, n, unit] of d.matchAll(new RegExp(DURATION_TOKEN, "g"))) {
    const mult =
      unit === "h" ? 3600000 : unit === "m" ? 60000 : unit === "s" ? 1000 : 1;
    ms += parseFloat(n) * mult;
  }
  return ms === 0 ? 0 : Math.max(1, Math.round(ms / 60000));
}

// Strict variant for config that must fail loud: throws on input that isn't a well-formed duration rather than silently reading it as 0 (= never hibernate).
export function durationToMinutesStrict(d: string): number {
  if (!new RegExp(`^(?:${DURATION_TOKEN})+$`).test(d.trim()))
    throw new Error(`not a valid duration: "${d}"`);
  return durationToMinutes(d);
}

// Render whole minutes as a Go duration string. 0 → "0s" (the never-hibernate sentinel), matching the chart-wide idleTimeout convention.
export function minutesToDuration(min: number): string {
  return min === 0 ? "0s" : `${min}m`;
}
