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

const GO_DURATION_UNITS = new Map<string, bigint>([
  ["ns", 1n],
  ["us", 1000n],
  ["µs", 1000n],
  ["μs", 1000n],
  ["ms", 1000000n],
  ["s", 1000000000n],
  ["m", 60000000000n],
  ["h", 3600000000000n],
]);

const NS_PER_MINUTE = 60000000000n;
const GO_MAX_DURATION = 1n << 63n;

// UNIT_BOUNDARY_DESCRIPTION: Go's `time.ParseDuration`, ported so the controller and the api-server read one grammar rather than two that agree by luck. A sign, then one or more decimal numbers each with a unit, or a bare zero. The integer part is kept in BigInt, so the `uint64` overflow checks Go makes are real here; the fraction adds `f * (unit/scale)` in `float64` as Go does, which is why `0.9999999999999999ns` is one nanosecond and not zero; and the result is rejected when it passes Go's int64 nanoseconds, so a duration the controller cannot hold is never a timeout here. Leading and trailing spaces are invalid, as they are to Go. Null means the controller rejected it too.
export function parseGoDurationNs(raw: string): bigint | null {
  let s = raw;
  let neg = false;
  if (s[0] === "-" || s[0] === "+") {
    neg = s[0] === "-";
    s = s.slice(1);
  }
  if (s === "0") return 0n;
  if (s === "") return null;
  let total = 0n;
  while (s !== "") {
    const lead = s[0]!;
    if (lead !== "." && (lead < "0" || lead > "9")) return null;
    const intPart = leadingInt(s);
    if (intPart === null) return null;
    s = intPart.rest;
    const pre = intPart.digits !== "";
    let fraction = 0n;
    let scale = 1;
    let post = false;
    if (s[0] === ".") {
      s = s.slice(1);
      const frac = leadingFraction(s);
      fraction = frac.value;
      scale = frac.scale;
      s = frac.rest;
      post = frac.digits !== "";
    }
    if (!pre && !post) return null;
    let unitEnd = 0;
    while (unitEnd < s.length) {
      const c = s[unitEnd]!;
      if (c === "." || (c >= "0" && c <= "9")) break;
      unitEnd++;
    }
    if (unitEnd === 0) return null;
    const unit = GO_DURATION_UNITS.get(s.slice(0, unitEnd));
    if (unit === undefined) return null;
    s = s.slice(unitEnd);
    if (intPart.value > GO_MAX_DURATION / unit) return null;
    let value = intPart.value * unit;
    if (fraction > 0n) {
      value += BigInt(Math.trunc(Number(fraction) * (Number(unit) / scale)));
      if (value > GO_MAX_DURATION) return null;
    }
    total += value;
    if (total > GO_MAX_DURATION) return null;
  }
  if (neg) return -total;
  if (total > GO_MAX_DURATION - 1n) return null;
  return total;
}

// UNIT_BOUNDARY_DESCRIPTION: Go's `leadingInt`: the run of digits at the front, or null when it would pass `uint64 1<<63`, which Go reports as an overflow rather than saturating.
function leadingInt(
  s: string,
): { value: bigint; digits: string; rest: string } | null {
  let i = 0;
  let value = 0n;
  while (i < s.length) {
    const c = s[i]!;
    if (c < "0" || c > "9") break;
    if (value > GO_MAX_DURATION / 10n) return null;
    value = value * 10n + BigInt(c.charCodeAt(0) - 48);
    if (value > GO_MAX_DURATION) return null;
    i++;
  }
  return { value, digits: s.slice(0, i), rest: s.slice(i) };
}

// UNIT_BOUNDARY_DESCRIPTION: Go's `leadingFraction`: the run of digits after a dot, kept only while it fits `uint64 1<<63`, with the decimal scale as the `float64` Go multiplies into it. Digits past the point the value stops growing are consumed and dropped, so an arbitrarily long fraction stays finite.
function leadingFraction(s: string): {
  value: bigint;
  scale: number;
  digits: string;
  rest: string;
} {
  let i = 0;
  let value = 0n;
  let scale = 1;
  let overflow = false;
  while (i < s.length) {
    const c = s[i]!;
    if (c < "0" || c > "9") break;
    if (overflow) {
      i++;
      continue;
    }
    if (value > (GO_MAX_DURATION - 1n) / 10n) {
      overflow = true;
      i++;
      continue;
    }
    const next = value * 10n + BigInt(c.charCodeAt(0) - 48);
    if (next > GO_MAX_DURATION) {
      overflow = true;
      i++;
      continue;
    }
    value = next;
    scale *= 10;
    i++;
  }
  return { value, scale, digits: s.slice(0, i), rest: s.slice(i) };
}

// UNIT_BOUNDARY_DESCRIPTION: a chart value the controller reads as a Go duration, such as 168h or 72h30m, read into milliseconds. Anything it cannot read is null, so a caller that only shows the value can say it is unknown rather than show a wrong one.
export function goDurationMs(raw: string): number | null {
  const ns = parseGoDurationNs(raw);
  return ns === null ? null : Number(ns) / 1e6;
}

// UNIT_BOUNDARY_DESCRIPTION: a per-Agent override, projected to the minutes the platform shows and counts. The field holds a Go duration, and the controller hibernates an Agent with a nonpositive one never, so a nonpositive duration here is 0 rather than an inherit-the-default read. A positive window under a minute projects to one minute, since the projection is what the UI shows and the usage report counts, and rounding it to zero would read as never-hibernate. A value the controller cannot parse is null, so the caller inherits the default the controller applies.
export function goDurationToMinutes(d: string): number | null {
  const ns = parseGoDurationNs(d);
  if (ns === null) return null;
  if (ns <= 0n) return 0;
  const minutes = Number((ns + NS_PER_MINUTE / 2n) / NS_PER_MINUTE);
  return Math.max(1, minutes);
}
