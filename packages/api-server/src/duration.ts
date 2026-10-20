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

const GO_DURATION_UNITS_NS: Record<string, number> = {
  ns: 1,
  us: 1e3,
  µs: 1e3,
  μs: 1e3,
  ms: 1e6,
  s: 1e9,
  m: 60e9,
  h: 3600e9,
};

const NS_PER_MINUTE = 60e9;

// UNIT_BOUNDARY_DESCRIPTION: a duration the controller reads with `time.ParseDuration`, read the same way: an optional sign, then one or more decimal numbers each with a unit, or a bare zero. Go accepts forms a digits-then-dot parser drops — a leading dot, an empty fraction, a sign, both spellings of the microsecond, and a signed zero with no unit — and it truncates a fractional nanosecond per term, so `0.1ns` is zero. Anything else is null. The whole and the fraction are scaled apart, so a fraction of any length stays finite; a magnitude past the int64 nanoseconds Go holds is null rather than an arithmetic artefact, and no idle timeout comes near it.
export function parseGoDurationNs(raw: string): number | null {
  const text = raw.trim();
  let sign = 1;
  let at = 0;
  if (text[0] === "+" || text[0] === "-") {
    if (text[0] === "-") sign = -1;
    at = 1;
  }
  const rest = text.slice(at);
  if (rest === "0") return 0;
  if (rest === "") return null;
  let total = 0;
  let read = 0;
  while (read < rest.length) {
    const part = /^(\d*\.?\d*)(ns|us|µs|μs|ms|s|m|h)/.exec(rest.slice(read));
    if (!part) return null;
    const digits = part[1] ?? "";
    const unit = GO_DURATION_UNITS_NS[part[2] ?? ""] ?? 0;
    const dot = digits.indexOf(".");
    const whole = dot < 0 ? digits : digits.slice(0, dot);
    const fraction = dot < 0 ? "" : digits.slice(dot + 1);
    if (whole === "" && fraction === "") return null;
    const term =
      Number(whole || "0") * unit +
      Math.trunc(Number(`0.${fraction || "0"}`) * unit);
    if (!Number.isFinite(term)) return null;
    total += term;
    read += part[0].length;
  }
  return sign * total;
}

// UNIT_BOUNDARY_DESCRIPTION: a chart value the controller reads as a Go duration, such as 168h or 72h30m, read into milliseconds. Anything it cannot read is null, so a caller that only shows the value can say it is unknown rather than show a wrong one.
export function goDurationMs(raw: string): number | null {
  const ns = parseGoDurationNs(raw);
  return ns === null ? null : ns / 1e6;
}

// UNIT_BOUNDARY_DESCRIPTION: a per-Agent override, projected to the minutes the platform shows and counts. The field holds a Go duration, and the controller hibernates an Agent with a nonpositive one never, so a nonpositive duration here is 0 rather than an inherit-the-default read. A positive window under a minute projects to one minute, since the projection is what the UI shows and the usage report counts, and rounding it to zero would read as never-hibernate. A value the controller cannot parse is null, so the caller inherits the default the controller applies.
export function goDurationToMinutes(d: string): number | null {
  const ns = parseGoDurationNs(d);
  if (ns === null) return null;
  return ns <= 0 ? 0 : Math.max(1, Math.round(ns / NS_PER_MINUTE));
}
