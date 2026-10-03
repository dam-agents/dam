const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)/;
const VERSION_HEADING = /^##\s+v?(\d+\.\d+\.\d+)\b/;

function semverParts(version: string): [number, number, number] | null {
  const m = SEMVER.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareSemver(a: string, b: string): number | null {
  const pa = semverParts(a);
  const pb = semverParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

function inRange(version: string, from: string, to: string): boolean {
  const afterFrom = compareSemver(version, from);
  const upToTo = compareSemver(version, to);
  return afterFrom !== null && afterFrom > 0 && upToTo !== null && upToTo <= 0;
}

export function changelogBetween(
  changelog: string,
  from: string,
  to: string,
): string | null {
  const sections: string[][] = [];
  let open: string[] | null = null;
  for (const line of changelog.split("\n")) {
    if (/^##\s/.test(line)) {
      const heading = VERSION_HEADING.exec(line);
      open = heading && inRange(heading[1]!, from, to) ? [line] : null;
      if (open) sections.push(open);
      continue;
    }
    open?.push(line);
  }
  const text = sections.map((s) => s.join("\n").trim());
  return text.length > 0 ? text.join("\n\n") : null;
}
