import type { SkillPath } from "../domain/skill-path.js";
import type { ShippedSkillManifest } from "../domain/shipped-manifest.js";
import type { LocalSkillRepository } from "../infrastructure/local-skill-repository.js";
import type { SeedLedger } from "../infrastructure/seed-ledger.js";

export interface ImageSkillReconciler {
  run(exemptNames: ReadonlySet<string>): Promise<void>;
}

export interface ImageSkillReconcilerDeps {
  repo: LocalSkillRepository;
  skillPaths: SkillPath[];
  seedRoots: SkillPath[];
  stagedRoots: SkillPath[];
  manifest: ShippedSkillManifest | undefined;
  ledger: SeedLedger;
  recoverSeedLedger: boolean;
  log: (msg: string) => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createImageSkillReconciler(
  deps: ImageSkillReconcilerDeps,
): ImageSkillReconciler {
  let running = false;
  let queued: ReadonlySet<string> | undefined;
  let recoverLedger = deps.recoverSeedLedger;
  let activeExempt = new Set<string>();
  const isExempt = (name: string) => activeExempt.has(name);

  async function run(exemptNames: ReadonlySet<string>): Promise<void> {
    if (!deps.manifest) return;
    if (running) {
      queued = exemptNames;
      for (const name of exemptNames) activeExempt.add(name);
      return;
    }
    running = true;
    activeExempt = new Set(exemptNames);
    try {
      if (recoverLedger) {
        await recoverPass(deps);
        recoverLedger = false;
      } else {
        await seedPass(deps, isExempt);
      }
      await managePass(deps, deps.manifest, isExempt);
    } catch (err) {
      deps.log(`image-skill reconcile failed: ${errorMessage(err)}`);
    } finally {
      running = false;
      const next = queued;
      queued = undefined;
      if (next) void run(next);
    }
  }

  return { run };
}

async function recoverPass(deps: ImageSkillReconcilerDeps): Promise<void> {
  const shipped = await deps.repo.listSkillDirs(deps.seedRoots);
  deps.ledger.addAll(shipped.map((s) => s.dir));
  deps.log(
    `seed ledger recovered: marked ${shipped.length} shipped skill(s) as already seeded without copying`,
  );
}

async function seedPass(
  deps: ImageSkillReconcilerDeps,
  isExempt: (name: string) => boolean,
): Promise<void> {
  const shipped = await deps.repo.listSkillDirs(deps.seedRoots);
  const seeded: string[] = [];
  for (const { dir, absDir } of shipped) {
    if (isExempt(dir) || deps.ledger.has(dir)) continue;
    try {
      if (!(await deps.repo.existsInAnyPath(dir, deps.skillPaths))) {
        await deps.repo.writeFromDir(dir, deps.skillPaths, absDir);
        deps.log(`seeded image skill "${dir}"`);
      }
      seeded.push(dir);
    } catch (err) {
      deps.log(`seeding "${dir}" failed: ${errorMessage(err)}`);
    }
  }
  deps.ledger.addAll(seeded);
}

async function managePass(
  deps: ImageSkillReconcilerDeps,
  manifest: ShippedSkillManifest,
  isExempt: (name: string) => boolean,
): Promise<void> {
  const pristineByDir = new Map(
    (
      await deps.repo.listSkillDirs([...deps.seedRoots, ...deps.stagedRoots])
    ).map((e) => [e.dir as string, e.absDir]),
  );
  for (const skillPath of deps.skillPaths) {
    for (const { dir, absDir } of await deps.repo.listSkillDirs([skillPath])) {
      if (isExempt(dir)) continue;
      const shippedHashes = Object.hasOwn(manifest.skills, dir)
        ? manifest.skills[dir]
        : undefined;
      if (!shippedHashes) continue;
      try {
        const localHash = await deps.repo.hashSkillDir(absDir);
        if (!shippedHashes.includes(localHash)) continue;
        const pristineDir = pristineByDir.get(dir);
        if (pristineDir === undefined) {
          await deps.repo.remove(dir, [skillPath]);
          deps.ledger.remove(dir);
          deps.log(`removed retired image skill "${dir}" from ${skillPath}`);
          continue;
        }
        if ((await deps.repo.hashSkillDir(pristineDir)) !== localHash) {
          await deps.repo.writeFromDir(dir, [skillPath], pristineDir);
          deps.log(
            `updated image skill "${dir}" in ${skillPath} to the shipped version`,
          );
        }
      } catch (err) {
        deps.log(`reconciling "${dir}" failed: ${errorMessage(err)}`);
      }
    }
  }
}
