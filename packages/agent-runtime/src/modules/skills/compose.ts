import type { SkillsService } from "agent-runtime-api";
import { createGitHubRestClient } from "./infrastructure/github-rest-client.js";
import { createGitProtocolClient } from "./infrastructure/git-protocol-client.js";
import { createLocalSkillRepository } from "./infrastructure/local-skill-repository.js";
import { createSkillsService } from "./services/skills-service.js";

export interface ComposeSkillsOptions {
  /** Wall-clock provider. Defaults to `() => new Date()`. Tests inject a
   *  fixed clock to pin publish branch timestamps. */
  now?: () => Date;
}

export function composeSkills(opts: ComposeSkillsOptions = {}): SkillsService {
  const github = createGitHubRestClient();
  const git = createGitProtocolClient();
  const repo = createLocalSkillRepository();
  return createSkillsService({
    github,
    git,
    repo,
    now: opts.now ?? (() => new Date()),
  });
}
