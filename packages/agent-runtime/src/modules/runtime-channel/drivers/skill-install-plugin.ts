import { existsSync, readFileSync, rmSync } from "node:fs";
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
  openJsonFile,
  type DocumentStore,
} from "../../../core/document-store.js";
import { expandHome } from "../../../core/expand-home.js";

const IMPL_NAME = "skill-install";

const STATE_FILE = "skill-install-state.json";

const stateSchema = z.object({
  installed: z.array(z.string()).catch([]).default([]),
});

const strictStateSchema = z.object({
  installed: z.array(z.string()),
});

export type SkillInstallBootState =
  | { kind: "ok"; installed: string[] }
  | { kind: "absent" }
  | { kind: "corrupt" };

export function readSkillInstallBootState(
  pluginStateRoot: string,
): SkillInstallBootState {
  const file = join(pluginStateRoot, IMPL_NAME, STATE_FILE);
  if (!existsSync(file)) return { kind: "absent" };
  try {
    const parsed = strictStateSchema.safeParse(
      JSON.parse(readFileSync(file, "utf8")),
    );
    return parsed.success
      ? { kind: "ok", installed: parsed.data.installed }
      : { kind: "corrupt" };
  } catch {
    return { kind: "corrupt" };
  }
}

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
      let stateStore: DocumentStore<z.infer<typeof stateSchema>> | undefined;

      return async (contributions, ctx) => {
        stateStore ??= openJsonFile(join(ctx.pluginStateDir, STATE_FILE), {
          schema: stateSchema,
          initial: () => ({ installed: [] }),
        });
        const skillPaths = configuredPaths.map((p) =>
          expandHome(p, ctx.agentHome),
        );
        const resolvedPaths = skillPaths.map((p) => resolve(p));
        const skillRefs = contributions.filter((c) => c.kind === "skill-ref");
        const managed = new Set(stateStore.read().installed);
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
        const failed: string[] = [];
        for (const c of contributions) {
          if (c.kind !== "skill-ref") continue;
          desired.add(c.name);
          const installInput: SkillInstallInput = {
            sourceUrl: c.sourceUrl,
            name: c.name,
            version: c.version,
            skillPaths,
            ...(c.path !== undefined ? { path: c.path } : {}),
          };
          ctx.log(
            `install ${c.name}@${c.version} from ${c.sourceUrl} into ${skillPaths.length} path(s)`,
          );
          const result = await deps.install(installInput);
          if (!result.ok) {
            ctx.log(
              `${c.name}@${c.version} from ${c.sourceUrl}: install failed (${result.error.kind})`,
            );
            failed.push(`${c.name} (${result.error.kind})`);
            continue;
          }
          ctx.log(`${c.name}@${c.version}: install ok`);
          installed.add(c.name);
        }

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
        stateStore.write({ installed: [...nextManaged].sort() });
        ctx.log(
          `managed now (${nextManaged.length}): ${
            nextManaged.join(", ") || "<none>"
          }; removed ${toRemove.length}`,
        );

        if (failed.length > 0) {
          throw new Error(
            `install failed for ${failed.length} skill(s): ${failed.join(", ")}`,
          );
        }
      };
    },
  };
}
