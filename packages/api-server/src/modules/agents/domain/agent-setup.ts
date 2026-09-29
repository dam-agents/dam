import type {
  AgentCreateInput,
  AgentSetup,
  AgentSetupResources,
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

function sizeAndStorage(
  resources: AgentSetupResources | undefined,
): Pick<AgentCreateInput, "size" | "storage"> {
  if (!resources) return {};
  const { cpu, memory, storage } = resources;
  return {
    ...(cpu !== undefined || memory !== undefined
      ? { size: { cpu, memory } }
      : {}),
    ...(storage !== undefined ? { storage } : {}),
  };
}

export function createInputFromSetup(
  setup: Pick<AgentSetup, "backend" | "resources" | "env"> & {
    seed?: AgentSetupSeed;
  },
): Pick<AgentCreateInput, "gitRepo" | "vm" | "size" | "storage" | "env"> {
  return {
    ...(setup.seed ? { gitRepo: seedGitRepo(setup.seed) } : {}),
    ...(setup.backend === "vm" ? { vm: true } : {}),
    ...sizeAndStorage(setup.resources),
    ...(setup.env && setup.env.length > 0 ? { env: setup.env } : {}),
  };
}
