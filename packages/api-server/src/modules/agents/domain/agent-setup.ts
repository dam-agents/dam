import type {
  AgentCreateInput,
  AgentSetup,
  AgentSetupSeed,
} from "api-server-api";

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function seedGitRepo(
  seed: AgentSetupSeed,
): NonNullable<AgentCreateInput["gitRepo"]> {
  const declaredCommit =
    seed.ref && COMMIT_SHA.test(seed.ref) ? seed.ref : undefined;
  const commit = seed.commit ?? declaredCommit;
  return {
    url: seed.url,
    into: seed.into,
    ...(commit ? { commit } : {}),
    ...(seed.ref && !declaredCommit ? { branch: seed.ref } : {}),
  };
}

export function createInputFromSetup(
  setup: Pick<AgentSetup, "resources" | "env"> & {
    seed?: AgentSetupSeed;
  },
): Pick<AgentCreateInput, "gitRepo" | "storage" | "env"> {
  return {
    ...(setup.seed ? { gitRepo: seedGitRepo(setup.seed) } : {}),
    ...(setup.resources?.storage !== undefined
      ? { storage: setup.resources.storage }
      : {}),
    ...(setup.env && setup.env.length > 0 ? { env: setup.env } : {}),
  };
}
