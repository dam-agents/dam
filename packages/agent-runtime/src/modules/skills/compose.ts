import type { SkillsService } from "agent-runtime-api";
import { makeSkillPaths } from "./domain/skill-path.js";
import { createGitHubRestClient } from "./infrastructure/github-rest-client.js";
import { createGitProtocolClient } from "./infrastructure/git-protocol-client.js";
import { createLocalSkillRepository } from "./infrastructure/local-skill-repository.js";
import { createSkillsService } from "./services/skills-service.js";

export interface ComposeSkillsOptions {
  /** Skill paths from the manifest's skill-ref driver ($HOME expanded). */
  skillPaths: string[];
  /** skill-ref paths re-expanded against the image workspace root —
   *  listLocal's origin-classification reference. */
  pristineSkillPaths: string[];
  /** Wall-clock provider. Defaults to `() => new Date()`. Tests inject a
   *  fixed clock to pin publish branch timestamps. */
  now?: () => Date;
  log: (msg: string) => void;
}

export function composeSkills(opts: ComposeSkillsOptions): SkillsService {
  const skillPaths = makeSkillPaths(opts.skillPaths);
  if (!skillPaths.ok) {
    throw new Error(
      `invalid skill path in runtime manifest: ${skillPaths.error.kind === "InvalidSkillPath" ? `${skillPaths.error.path} (${skillPaths.error.reason})` : JSON.stringify(opts.skillPaths)}`,
    );
  }
  const pristineSkillPaths = makeSkillPaths(opts.pristineSkillPaths);
  if (!pristineSkillPaths.ok) {
    throw new Error(
      `invalid pristine skill path: ${pristineSkillPaths.error.kind === "InvalidSkillPath" ? `${pristineSkillPaths.error.path} (${pristineSkillPaths.error.reason})` : JSON.stringify(opts.pristineSkillPaths)}`,
    );
  }
  const github = createGitHubRestClient();
  const git = createGitProtocolClient();
  const repo = createLocalSkillRepository();
  return createSkillsService({
    github,
    git,
    repo,
    skillPaths: skillPaths.value,
    pristineSkillPaths: pristineSkillPaths.value,
    now: opts.now ?? (() => new Date()),
    log: opts.log,
  });
}
