import type { FileProducer } from "./types.js";
import {
  makeGithubEnterpriseHostsProducer,
  type GithubEnterpriseHostsDeps,
} from "./producers/github-enterprise-hosts.js";

/**
 * The complete list of pod-files producers. Adding a new managed file is
 * one entry here plus a producer factory under `producers/`. Producers may
 * read state from any source (connections, secrets, schedules, …) — the
 * platform doesn't care.
 */
export interface PodFilesRegistryDeps extends GithubEnterpriseHostsDeps {
  // Future producers' deps merge in here.
}

export function buildPodFilesRegistry(
  deps: PodFilesRegistryDeps,
): readonly FileProducer[] {
  return [makeGithubEnterpriseHostsProducer(deps)];
}
