import { existsSync, rmSync } from "node:fs";
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
import {
  createSkillInstallStateStore,
  type SkillInstallStateStore,
} from "../infrastructure/skill-install-state-store.js";
import { expandHome } from "../../../core/expand-home.js";

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
      // State lives in this plugin's own dir (ctx.pluginStateDir), known only
      // at dispatch; created once and reused across dispatches.
      let stateStore: SkillInstallStateStore | undefined;

      return async (contributions, ctx) => {
        stateStore ??= createSkillInstallStateStore(ctx.pluginStateDir);
        const skillPaths = configuredPaths.map((p) =>
          expandHome(p, ctx.agentHome),
        );
        const resolvedPaths = skillPaths.map((p) => resolve(p));
        const skillRefs = contributions.filter((c) => c.kind === "skill-ref");
        const managed = new Set(stateStore.getInstalled());
        ctx.log(
          `wanted (${skillRefs.length}): ${
            skillRefs.length === 0
              ? "<none>"
              : skillRefs
                  .map((c) =>
                    c.kind === "skill-ref" ? `${c.name}@${c.version}` : "",
                  )
                  .join(", ")
          }; targets: ${resolvedPaths.join(", ") || "<none>"}; managed: ${
            [...managed].join(", ") || "<none>"
          }`,
        );

        const desired = new Set<string>();
        const installed = new Set<string>();
        for (const c of contributions) {
          if (c.kind !== "skill-ref") continue;
          desired.add(c.name);
          const installInput: SkillInstallInput = {
            sourceUrl: c.sourceUrl,
            name: c.name,
            version: c.version,
            skillPaths,
          };
          ctx.log(
            `install ${c.name}@${c.version} from ${c.sourceUrl} into ${skillPaths.length} path(s)`,
          );
          const result = await deps.install(installInput);
          if (!result.ok) {
            ctx.log(
              `${c.name}@${c.version} from ${c.sourceUrl}: install failed (${result.error.kind})`,
            );
            continue;
          }
          ctx.log(`${c.name}@${c.version}: install ok`);
          installed.add(c.name);
        }

        // Only remove skills this driver installed before that are no longer
        // desired. Seeded skills (platform-base) and standalone skills authored
        // on disk are never in `managed`, so the sweep leaves them untouched.
        const toRemove = [...managed].filter((name) => !desired.has(name));
        for (const root of resolvedPaths) {
          for (const name of toRemove) {
            const p = join(root, name);
            if (!existsSync(p)) continue;
            try {
              rmSync(p, { recursive: true, force: true });
              ctx.log(`removed ${p}`);
            } catch (err) {
              ctx.log(`failed to remove ${p}: ${(err as Error).message}`);
            }
          }
        }

        const nextManaged = [...desired].filter(
          (name) => managed.has(name) || installed.has(name),
        );
        stateStore.setInstalled(nextManaged);
        ctx.log(
          `managed now (${nextManaged.length}): ${
            nextManaged.join(", ") || "<none>"
          }; removed ${toRemove.length}`,
        );
      };
    },
  };
}

export const SKILL_INSTALL_PLUGIN_NAME = IMPL_NAME;
