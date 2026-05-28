// Server-advertised compatibility floor (ADR-039). Domain has no
// dependencies — the comparator is inlined rather than pulling a semver
// lib so the layering rule stays clean.

export type CompatVerdict =
  | {
      kind: "ok";
      localCli: string;
      serverVersion: string;
      serverMinClient: string | undefined;
    }
  | {
      kind: "behind-current";
      localCli: string;
      serverVersion: string;
      serverMinClient: string | undefined;
    }
  | {
      kind: "below-floor";
      localCli: string;
      serverVersion: string;
      serverMinClient: string;
    };

export interface VerdictInputs {
  localCli: string;
  serverVersion: string;
  serverMinClient: string | undefined;
}

export function verdictFor(inputs: VerdictInputs): CompatVerdict {
  const { localCli, serverVersion, serverMinClient } = inputs;
  if (
    serverMinClient !== undefined &&
    compareVersions(localCli, serverMinClient) < 0
  ) {
    return { kind: "below-floor", localCli, serverVersion, serverMinClient };
  }
  if (compareVersions(localCli, serverVersion) < 0) {
    return {
      kind: "behind-current",
      localCli,
      serverVersion,
      serverMinClient,
    };
  }
  return { kind: "ok", localCli, serverVersion, serverMinClient };
}

/**
 * Semver compare per https://semver.org/. Throws on invalid input — both
 * inputs in production come from package.json (CLI) and `/api/version`
 * (server), where invalid input is a bug worth surfacing.
 *
 * Build metadata (`+...`) is ignored. Pre-release (`-rc.1` etc.) is
 * compared per the semver spec: a version with pre-release ranks lower
 * than the same version without.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  const coreCmp = cmpNum3(
    [pa.major, pa.minor, pa.patch],
    [pb.major, pb.minor, pb.patch],
  );
  if (coreCmp !== 0) return coreCmp;

  return comparePreRelease(pa.preRelease, pb.preRelease);
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  preRelease: string[];
}

function parseSemver(v: string): ParsedSemver {
  const stripped = v.replace(/^v/, "").split("+")[0]!;
  const dashIdx = stripped.indexOf("-");
  const core = dashIdx === -1 ? stripped : stripped.slice(0, dashIdx);
  const pre = dashIdx === -1 ? "" : stripped.slice(dashIdx + 1);

  const parts = core.split(".");
  if (parts.length !== 3) {
    throw new Error(`invalid semver: ${v}`);
  }
  const nums = parts.map((s) => {
    const n = Number.parseInt(s, 10);
    if (!/^\d+$/.test(s) || Number.isNaN(n)) {
      throw new Error(`invalid semver: ${v}`);
    }
    return n;
  });

  return {
    major: nums[0]!,
    minor: nums[1]!,
    patch: nums[2]!,
    preRelease: pre === "" ? [] : pre.split("."),
  };
}

function cmpNum3(
  a: [number, number, number],
  b: [number, number, number],
): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

function comparePreRelease(a: string[], b: string[]): -1 | 0 | 1 {
  // Per semver §11: a version with pre-release < same version without.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const ai = a[i]!;
    const bi = b[i]!;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const an = Number.parseInt(ai, 10);
      const bn = Number.parseInt(bi, 10);
      if (an < bn) return -1;
      if (an > bn) return 1;
    } else if (aNum) {
      return -1;
    } else if (bNum) {
      return 1;
    } else {
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
  }
  return 0;
}
