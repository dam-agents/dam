import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Built-in `skill-install` impl. Wraps the existing agent-runtime skill-fetch
 * helpers — composer injects the install function so this module is
 * decoupled from the skills module's transport (github/git client).
 *
 * On apply, materializes the desired set into the configured skill paths
 * (the manifest's `paths: [...]`). Removes any skill directories under those
 * paths that aren't in the desired set.
 */

export interface SkillInstallInput {
  sourceUrl: string;
  name: string;
  version: string;
}

export interface SkillInstallContext {
  paths: string[];
  log: (msg: string) => void;
  install(input: SkillInstallInput, paths: string[]): Promise<boolean>;
}

export interface SkillInstallImpl {
  apply(desired: SkillInstallInput[], ctx: SkillInstallContext): Promise<void>;
}

export function createSkillInstallImpl(): SkillInstallImpl {
  return {
    async apply(
      desired: SkillInstallInput[],
      ctx: SkillInstallContext,
    ): Promise<void> {
      const wantedDirs = new Set<string>();
      const resolvedPaths = ctx.paths.map((p) => resolve(p));

      // Install everything desired. Re-installing same source@version is a
      // no-op in the underlying helper.
      for (const skill of desired) {
        const ok = await ctx.install(skill, ctx.paths);
        if (!ok) {
          ctx.log(
            `[skill-install] ${skill.name}@${skill.version} from ${skill.sourceUrl}: install failed`,
          );
          continue;
        }
        for (const root of resolvedPaths) {
          wantedDirs.add(join(root, skill.name));
        }
      }

      // Snapshot reconciliation — remove any skill directory under
      // ctx.paths that isn't in the desired set.
      for (const root of resolvedPaths) {
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root)) {
          const p = join(root, entry);
          try {
            if (!statSync(p).isDirectory()) continue;
          } catch {
            continue;
          }
          if (wantedDirs.has(p)) continue;
          try {
            rmSync(p, { recursive: true, force: true });
            ctx.log(`[skill-install] removed ${p}`);
          } catch (err) {
            ctx.log(
              `[skill-install] failed to remove ${p}: ${(err as Error).message}`,
            );
          }
        }
      }
    },
  };
}
