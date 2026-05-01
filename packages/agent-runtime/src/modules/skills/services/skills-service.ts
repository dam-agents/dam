import type {
  InstallSkillInput,
  ListLocalSkillsInput,
  PublishSkillInput,
  ReadLocalSkillInput,
  Result,
  ScanSkillSourceInput,
  SkillsDomainError,
  SkillsService,
  UninstallSkillInput,
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

export interface SkillsServiceDeps {
  github: GitHubRestClient;
  git: GitProtocolClient;
  repo: LocalSkillRepository;
  /** Wall-clock provider — used by publish for branch-name timestamps. */
  now: () => Date;
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
    install: (input: InstallSkillInput) => doInstall(deps, input),
    uninstall: (input: UninstallSkillInput) => doUninstall(deps, input),
    listLocal: (input: ListLocalSkillsInput) => doListLocal(deps, input),
    readLocal: (input: ReadLocalSkillInput) => doReadLocal(deps, input),
    scan: (input: ScanSkillSourceInput) => runScan(deps, input),
    publish: (input: PublishSkillInput) => doPublish(deps, input),
  };
}

async function doInstall(deps: SkillsServiceDeps, input: InstallSkillInput) {
  const validated = validateNameAndPaths(input.name, input.skillPaths);
  if (!validated.ok) return validated;
  return runInstall(deps, validated.value.name, validated.value.skillPaths, input);
}

async function doUninstall(deps: SkillsServiceDeps, input: UninstallSkillInput) {
  const validated = validateNameAndPaths(input.name, input.skillPaths);
  if (!validated.ok) return validated;
  await deps.repo.remove(validated.value.name, validated.value.skillPaths);
  return ok(undefined);
}

async function doListLocal(deps: SkillsServiceDeps, input: ListLocalSkillsInput) {
  const skillPaths = makeSkillPaths(input.skillPaths);
  if (!skillPaths.ok) return skillPaths;
  const skills = await deps.repo.listLocal(skillPaths.value);
  return ok(skills);
}

async function doReadLocal(deps: SkillsServiceDeps, input: ReadLocalSkillInput) {
  const validated = validateNameAndPaths(input.name, input.skillPaths);
  if (!validated.ok) return validated;
  return deps.repo.readLocal(validated.value.name, validated.value.skillPaths);
}

async function doPublish(deps: SkillsServiceDeps, input: PublishSkillInput) {
  const validated = validateNameAndPaths(input.name, input.skillPaths);
  if (!validated.ok) return validated;
  return runPublish(deps, validated.value.name, validated.value.skillPaths, input);
}
