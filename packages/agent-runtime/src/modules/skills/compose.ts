import type { SkillsService } from "agent-runtime-api";
import { makeSkillPaths, type SkillPath } from "./domain/skill-path.js";
import { createGitHubRestClient } from "./infrastructure/github-rest-client.js";
import { createGitProtocolClient } from "./infrastructure/git-protocol-client.js";
import {
  createLocalSkillRepository,
  type LocalSkillRepository,
} from "./infrastructure/local-skill-repository.js";
import { openSeedLedger } from "./infrastructure/seed-ledger.js";
import { loadShippedSkillManifest } from "./infrastructure/shipped-manifest-loader.js";
import {
  createImageSkillReconciler,
  type ImageSkillReconciler,
} from "./services/reconcile-image-skills.js";
import { createSkillsService } from "./services/skills-service.js";

export interface ReconcileOptions {
  seedRoots: string[];
  stagedRoots: string[];
  manifestFile: string;
  stateDir: string;
}

export interface ComposeSkillsOptions {
  skillPaths: string[];
  pristineSkillPaths: string[];
  reconcile?: ReconcileOptions;
  now?: () => Date;
  log: (msg: string) => void;
}

export interface SkillsComposition {
  service: SkillsService;
  reconciler: ImageSkillReconciler | undefined;
}

export function composeSkills(opts: ComposeSkillsOptions): SkillsComposition {
  const skillPaths = validated(opts.skillPaths, "skill path");
  const pristineSkillPaths = validated(
    opts.pristineSkillPaths,
    "pristine skill path",
  );
  const github = createGitHubRestClient();
  const git = createGitProtocolClient();
  const repo = createLocalSkillRepository();
  const service = createSkillsService({
    github,
    git,
    repo,
    skillPaths,
    pristineSkillPaths,
    now: opts.now ?? (() => new Date()),
    log: opts.log,
  });
  const reconciler = opts.reconcile
    ? buildReconciler(opts.reconcile, repo, skillPaths, opts.log)
    : undefined;
  return { service, reconciler };
}

function buildReconciler(
  reconcile: ReconcileOptions,
  repo: LocalSkillRepository,
  skillPaths: SkillPath[],
  log: (msg: string) => void,
): ImageSkillReconciler | undefined {
  const seedRoots = validated(reconcile.seedRoots, "seed root");
  if (seedRoots.length === 0) {
    log(
      "image-skill reconcile disabled: no pristine seed root distinct from the skill paths",
    );
    return undefined;
  }
  const opened = openSeedLedger(reconcile.stateDir);
  if (opened.kind === "corrupt") {
    log(
      `seed ledger at ${opened.file} is corrupt; image-skill seeding disabled on this volume (delete the file to re-enable), update and retire reconciliation still runs`,
    );
  }
  return createImageSkillReconciler({
    repo,
    skillPaths,
    seedRoots,
    stagedRoots: validated(reconcile.stagedRoots, "staged root"),
    manifest: loadShippedSkillManifest(reconcile.manifestFile, log),
    ledger: opened.kind === "ok" ? opened.ledger : undefined,
    log,
  });
}

function validated(paths: string[], label: string): SkillPath[] {
  const made = makeSkillPaths(paths);
  if (!made.ok) {
    throw new Error(
      `invalid ${label}: ${made.error.kind === "InvalidSkillPath" ? `${made.error.path} (${made.error.reason})` : JSON.stringify(paths)}`,
    );
  }
  return made.value;
}
