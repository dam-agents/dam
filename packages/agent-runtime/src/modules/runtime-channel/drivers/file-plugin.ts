import type {
  Contribution,
  DriverBinding,
  KindHandler,
  Plugin,
} from "agent-runtime-api";
import { createFileOps, type FileDesired } from "../infrastructure/file-ops.js";

/**
 * Built-in `file` plugin (ADR-052). Binds the `file` Contribution kind
 * to the shared file-ops infrastructure. Per-contribution carries its
 * own `{ path, format, mergeMode, content }`; no binding-level config.
 *
 * Manifest:
 *   drivers:
 *     file:
 *       impl: file
 */
const IMPL_NAME = "file";

export function createFilePlugin(): Plugin {
  const fileOps = createFileOps();

  return {
    name: IMPL_NAME,

    bind(kind: string, _binding: DriverBinding): KindHandler {
      if (kind !== "file") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle kind "${kind}" — bind it to "file" only`,
        );
      }
      return async (contributions, ctx) => {
        const desired = new Map<string, FileDesired[]>();
        for (const c of contributions) {
          if (c.kind !== "file") continue;
          const path = expandHome(c.path, ctx.agentHome);
          const list = desired.get(path) ?? [];
          list.push({
            format: c.format,
            mergeMode: c.mergeMode,
            content: c.content,
          });
          desired.set(path, list);
        }
        await fileOps.apply(desired as Map<string, FileDesired[] | null>, {
          agentHome: ctx.agentHome,
          log: ctx.log,
        });
      };
    },
  };
}

function expandHome(path: string, agentHome: string): string {
  return path.replace(/\$HOME\b/g, agentHome).replace(/\$\{HOME\}/g, agentHome);
}

// Used by the plugin registry to short-circuit name collisions —
// extension authors MUST NOT register a plugin under this name.
export const FILE_PLUGIN_NAME = IMPL_NAME;
// Re-exported so callers (e.g. tests) can construct the same type that
// `bind` returns without going through the plugin port.
export type { Contribution };
