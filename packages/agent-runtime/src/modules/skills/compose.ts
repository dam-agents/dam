import type { SkillsService } from "agent-runtime-api";
import { makeSkillPaths } from "./domain/skill-path.js";
import { createGitHubRestClient } from "./infrastructure/github-rest-client.js";
import { createGitProtocolClient } from "./infrastructure/git-protocol-client.js";
import { createLocalSkillRepository } from "./infrastructure/local-skill-repository.js";
import { createSkillsService } from "./services/skills-service.js";

export interface ComposeSkillsOptions {
  /** Skill paths from the manifest's skill-ref driver ($HOME expanded). */
  skillPaths: string[];
  /** Wall-clock provider. Defaults to `() => new Date()`. Tests inject a
   *  fixed clock to pin publish branch timestamps. */
  now?: () => Date;
}

export function composeSkills(opts: ComposeSkillsOptions): SkillsService {
  const skillPaths = makeSkillPaths(opts.skillPaths);
  if (!skillPaths.ok) {
    throw new Error(
      `invalid skill path in runtime manifest: ${skillPaths.error.kind === "InvalidSkillPath" ? `${skillPaths.error.path} (${skillPaths.error.reason})` : JSON.stringify(opts.skillPaths)}`,
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
    now: opts.now ?? (() => new Date()),
  });
}
