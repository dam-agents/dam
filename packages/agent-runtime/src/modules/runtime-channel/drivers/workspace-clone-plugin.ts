import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type {
  DriverBinding,
  KindHandler,
  Plugin,
  Result,
  SkillsDomainError,
} from "agent-runtime-api";
import { createGitProtocolClient } from "../../skills/infrastructure/git-protocol-client.js";
import { expandHome } from "./expand-home.js";

const IMPL_NAME = "workspace-clone";
const DEFAULT_TARGET = "$HOME/work";

const bindingSchema = z.object({
  impl: z.literal(IMPL_NAME),
  target: z.string().min(1).optional(),
});

/** Clone fn, injectable for tests; defaults to GitProtocolClient (proxy + CA aware). */
export type CloneFn = (
  url: string,
  dest: string,
) => Promise<Result<void, SkillsDomainError>>;

/** Driver for the one-shot `workspace-git` contribution (see its schema for the
 *  skip/throw/clone contract). Bound before `skill-ref` in runtime-manifest.yaml
 *  so the workspace exists before anything layers onto it. */
export function createWorkspaceClonePlugin(
  deps: { clone?: CloneFn } = {},
): Plugin {
  const clone: CloneFn =
    deps.clone ??
    ((url, dest) => createGitProtocolClient().cloneShallow(url, dest));
  return {
    name: IMPL_NAME,

    bind(kind: string, binding: DriverBinding): KindHandler {
      if (kind !== "workspace-git") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle kind "${kind}" — bind it to "workspace-git" only`,
        );
      }
      const parsed = bindingSchema.safeParse(binding);
      if (!parsed.success) {
        throw new Error(
          `plugin "${IMPL_NAME}" invalid binding: ${parsed.error.message}`,
        );
      }
      const configuredTarget = parsed.data.target ?? DEFAULT_TARGET;

      return async (contributions, ctx) => {
        // The producer emits at most one (PK on agent_id); take the first.
        const seed = contributions.find((c) => c.kind === "workspace-git");
        if (seed?.kind !== "workspace-git") return;

        const target = resolve(expandHome(configuredTarget, ctx.agentHome));

        if (existsSync(join(target, ".git"))) {
          ctx.log(`${target} already seeded (.git present), skipping`);
          return;
        }
        if (existsSync(target) && readdirSync(target).length > 0) {
          throw new Error(
            `refusing to seed a non-empty work directory: ${target}`,
          );
        }

        ctx.log(`cloning ${seed.sourceUrl} into ${target}`);
        const res = await clone(seed.sourceUrl, target);
        if (!res.ok) {
          const e = res.error;
          const detail = "detail" in e ? `: ${e.detail}` : "";
          throw new Error(
            `workspace clone of ${seed.sourceUrl} failed (${e.kind})${detail}`,
          );
        }
        ctx.log(`cloned ${seed.sourceUrl} into ${target}`);
      };
    },
  };
}

export const WORKSPACE_CLONE_PLUGIN_NAME = IMPL_NAME;
