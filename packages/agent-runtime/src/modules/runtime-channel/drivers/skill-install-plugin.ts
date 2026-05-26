import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type {
  DriverBinding,
  KindHandler,
  Plugin,
  SkillInstallInput,
  SkillInstallResult,
  Result,
  SkillsDomainError,
} from "agent-runtime-api";

const IMPL_NAME = "skill-install";

const bindingSchema = z.object({
  impl: z.literal(IMPL_NAME),
  paths: z.array(z.string().min(1)).min(1),
});

export type SkillInstallFn = (
  input: SkillInstallInput,
) => Promise<Result<SkillInstallResult, SkillsDomainError>>;

export function createSkillInstallPlugin(deps: {
  install: SkillInstallFn;
}): Plugin {
  return {
    name: IMPL_NAME,

    bind(kind: string, binding: DriverBinding): KindHandler {
      if (kind !== "skill-ref") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle kind "${kind}" — bind it to "skill-ref" only`,
        );
      }
      const parsed = bindingSchema.safeParse(binding);
      if (!parsed.success) {
        throw new Error(
          `plugin "${IMPL_NAME}" invalid binding: ${parsed.error.message}`,
        );
      }
      const configuredPaths = parsed.data.paths;

      return async (contributions, ctx) => {
        const skillPaths = configuredPaths.map((p) =>
          expandHome(p, ctx.agentHome),
        );
        const resolvedPaths = skillPaths.map((p) => resolve(p));
        const wantedDirs = new Set<string>();

        for (const c of contributions) {
          if (c.kind !== "skill-ref") continue;
          const installInput: SkillInstallInput = {
            sourceUrl: c.sourceUrl,
            name: c.name,
            version: c.version,
            skillPaths,
          };
          const result = await deps.install(installInput);
          if (!result.ok) {
            ctx.log(
              `[skill-install] ${c.name}@${c.version} from ${c.sourceUrl}: install failed (${result.error.kind})`,
            );
            continue;
          }
          for (const root of resolvedPaths) {
            wantedDirs.add(join(root, c.name));
          }
        }

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
      };
    },
  };
}

function expandHome(path: string, agentHome: string): string {
  return path.replace(/\$HOME\b/g, agentHome).replace(/\$\{HOME\}/g, agentHome);
}

export const SKILL_INSTALL_PLUGIN_NAME = IMPL_NAME;
