const SEGMENT_SEPARATOR = /\/|\\|%2f|%5c/i;
const ENCODED_DOT = /%2e/gi;

// UNIT_BOUNDARY_DESCRIPTION: rules match the path as sent, but an upstream may resolve `.` and `..` first — the GitHub Contents API answers `contents/qa/../README` and `contents/qa/..;x/README` with README — so a path with such a segment, raw, `%2e`-encoded or with a `;` suffix, can reach a file no rule names.
export function hasDotSegment(path: string): boolean {
  const queryAt = path.indexOf("?");
  return (queryAt === -1 ? path : path.slice(0, queryAt))
    .split(SEGMENT_SEPARATOR)
    .some((segment) => {
      const name = segment.replace(ENCODED_DOT, ".").split(";")[0];
      return name === "." || name === "..";
    });
}
