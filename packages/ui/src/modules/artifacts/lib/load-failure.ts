interface QueryFailure {
  data?: { code?: unknown } | null;
}

/** UNIT_BOUNDARY_DESCRIPTION: An artifact that is gone or another owner's answers `NOT_FOUND`, which is a state of the library and not a failure to load it: the preview says there is no such artifact, and only a real failure offers a retry. */
export function artifactMissing(error: unknown): boolean {
  return (error as QueryFailure | null | undefined)?.data?.code === "NOT_FOUND";
}
