import type { OwnerDirectoryPort } from "../../api-keys/services/owner-active-probe.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the person behind an assistant's token is
 * still admitted, asked of the directory every time and answered *no* whenever
 * the directory cannot say. The API-key path keeps its cached, fail-open probe,
 * which predates this; an assistant's token is a machine's, so an unreachable
 * directory must close it rather than wave it through.
 */
export function createFailClosedOwnerActive(deps: {
  directory: OwnerDirectoryPort;
}): (sub: string) => Promise<boolean> {
  return (sub) => deps.directory.isActive(sub).catch(() => false);
}
