import type {
  Contribution,
  DriverBinding,
  KindHandler,
  Plugin,
} from "agent-runtime-api";
import { createFileOps, type FileDesired } from "../infrastructure/file-ops.js";

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

export const FILE_PLUGIN_NAME = IMPL_NAME;
export type { Contribution };
