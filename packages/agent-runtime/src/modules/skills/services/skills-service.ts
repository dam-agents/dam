import type {
  SkillDeleteLocalInput,
  SkillInstallInput,
  SkillPublishInput,
  SkillListLocalInput,
  SkillReadLocalInput,
  SkillReadPullRequestInput,
  Result,
  SkillScanInput,
  SkillsDomainError,
  SkillsService,
  SkillUninstallInput,
  SkillWriteLocalInput,
} from "agent-runtime-api";
import { ok } from "agent-runtime-api";
import { makeSkillName, type SkillName } from "../domain/skill-name.js";
import { makeSkillPaths, type SkillPath } from "../domain/skill-path.js";
import type { GitHubRestClient } from "../infrastructure/github-rest-client.js";
import type { GitProtocolClient } from "../infrastructure/git-protocol-client.js";
import type { LocalSkillRepository } from "../infrastructure/local-skill-repository.js";
import { runInstall } from "./install.js";
import { runPublish } from "./publish.js";
import { runScan } from "./scan.js";
import { runWriteLocal } from "./write-local.js";

export interface SkillsServiceDeps {
  github: GitHubRestClient;
  git: GitProtocolClient;
  repo: LocalSkillRepository;
  /** Read-side paths (listLocal / readLocal / publish), from the manifest's
   *  skill-ref driver. install / uninstall get theirs from the driver. */
  skillPaths: SkillPath[];
  /** Image-side counterparts of `skillPaths`, listLocal's origin reference.
   *  Nonexistent dirs are harmless — everything classifies as `user`. */
  pristineSkillPaths: SkillPath[];
  /** Wall-clock provider — used by publish for branch-name timestamps. */
  now: () => Date;
  log: (msg: string) => void;
}

interface ValidatedNameAndPaths {
  name: SkillName;
  skillPaths: SkillPath[];
}

function validateNameAndPaths(
  rawName: string,
  rawPaths: string[],
): Result<ValidatedNameAndPaths, SkillsDomainError> {
  const name = makeSkillName(rawName);
  if (!name.ok) return name;
  const skillPaths = makeSkillPaths(rawPaths);
  if (!skillPaths.ok) return skillPaths;
  return ok({ name: name.value, skillPaths: skillPaths.value });
}

export function createSkillsService(deps: SkillsServiceDeps): SkillsService {
  return {
    install: (input: SkillInstallInput) => doInstall(deps, input),
    uninstall: (input: SkillUninstallInput) => doUninstall(deps, input),
    listLocal: (input?: SkillListLocalInput) => doListLocal(deps, input),
    readLocal: (input: SkillReadLocalInput) => doReadLocal(deps, input),
    readPullRequest: (input: SkillReadPullRequestInput) =>
      deps.github.getPullRequest(
        { owner: input.owner, repo: input.repo },
        input.number,
      ),
    deleteLocal: (input: SkillDeleteLocalInput) => doDeleteLocal(deps, input),
    writeLocal: (input: SkillWriteLocalInput) =>
      runWriteLocal(deps, deps.skillPaths, input),
    scan: (input: SkillScanInput) => runScan(deps, input),
    publish: (input: SkillPublishInput) => doPublish(deps, input),
  };
}

async function doInstall(deps: SkillsServiceDeps, input: SkillInstallInput) {
  const validated = validateNameAndPaths(input.name, input.skillPaths);
  if (!validated.ok) return validated;
  return runInstall(
    deps,
    validated.value.name,
    validated.value.skillPaths,
    input,
  );
}

async function doUninstall(
  deps: SkillsServiceDeps,
  input: SkillUninstallInput,
) {
  const validated = validateNameAndPaths(input.name, input.skillPaths);
  if (!validated.ok) return validated;
  await deps.repo.remove(validated.value.name, validated.value.skillPaths);
  return ok(undefined);
}

async function doListLocal(
  deps: SkillsServiceDeps,
  input?: SkillListLocalInput,
) {
  const skills = await deps.repo.listLocal(
    deps.skillPaths,
    deps.pristineSkillPaths,
    input?.hashNames ? new Set(input.hashNames) : undefined,
  );
  return ok(skills);
}

async function doReadLocal(
  deps: SkillsServiceDeps,
  input: SkillReadLocalInput,
) {
  const name = makeSkillName(input.name);
  if (!name.ok) return name;
  return deps.repo.readLocal(name.value, deps.skillPaths);
}

async function doDeleteLocal(
  deps: SkillsServiceDeps,
  input: SkillDeleteLocalInput,
) {
  const name = makeSkillName(input.name);
  if (!name.ok) return name;
  const resolved = await deps.repo.resolveLocalSkillDir(
    name.value,
    deps.skillPaths,
  );
  // Nothing on disk to remove — a delete whose target is already gone is
  // satisfied, not an error (a double-click must not fail the second time).
  if (!resolved) return ok(undefined);
  await deps.repo.remove(resolved.dir, deps.skillPaths);
  return ok(undefined);
}

async function doPublish(deps: SkillsServiceDeps, input: SkillPublishInput) {
  const name = makeSkillName(input.name);
  if (!name.ok) return name;
  return runPublish(deps, name.value, deps.skillPaths, input);
}
