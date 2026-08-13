import type {
  SkillDeleteLocalInput,
  SkillInstallInput,
  SkillPublishInput,
  SkillListLocalInput,
  SkillReadLocalInput,
  SkillReadPullRequestInput,
  SkillReadSkillFileInput,
  Result,
  SkillScanInput,
  SkillsDomainError,
  SkillsService,
  SkillUninstallInput,
  SkillWriteLocalInput,
} from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import { makeSkillName, type SkillName } from "../domain/skill-name.js";
import { makeSkillPaths, type SkillPath } from "../domain/skill-path.js";
import type { GitHubRestClient } from "../infrastructure/github-rest-client.js";
import { detectGithubOwnerRepo } from "../infrastructure/github-rest-client.js";
import type { GitProtocolClient } from "../infrastructure/git-protocol-client.js";
import type { LocalSkillRepository } from "../infrastructure/local-skill-repository.js";
import { subPathEscapes } from "../infrastructure/local-skill-repository.js";
import { runInstall } from "./install.js";
import { runPublish } from "./publish.js";
import { runScan } from "./scan.js";
import { runWriteLocal } from "./write-local.js";

export interface SkillsServiceDeps {
  github: GitHubRestClient;
  git: GitProtocolClient;
  repo: LocalSkillRepository;
  skillPaths: SkillPath[];
  pristineSkillPaths: SkillPath[];
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
    readSkillFile: (input: SkillReadSkillFileInput) =>
      doReadSkillFile(deps, input),
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

async function doReadSkillFile(
  deps: SkillsServiceDeps,
  input: SkillReadSkillFileInput,
): Promise<Result<{ content: string }, SkillsDomainError>> {
  const host = detectGithubOwnerRepo(input.source);
  if (!host) {
    return err({
      kind: "SourceFetchFailed",
      source: input.source,
      detail: "not a github.com repository",
    });
  }
  if (subPathEscapes(input.dir)) {
    return err({
      kind: "SourceFetchFailed",
      source: input.source,
      detail: `skill dir rejected: ${input.dir}`,
    });
  }
  const read = await deps.github.getFileContent(
    host,
    input.version,
    `${input.dir}/SKILL.md`,
  );
  if (!read.ok) return read;
  return ok({ content: read.value });
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
  if (!resolved) return ok(undefined);
  await deps.repo.remove(resolved.dir, deps.skillPaths);
  return ok(undefined);
}

async function doPublish(deps: SkillsServiceDeps, input: SkillPublishInput) {
  const name = makeSkillName(input.name);
  if (!name.ok) return name;
  return runPublish(deps, name.value, deps.skillPaths, input);
}
