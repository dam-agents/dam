import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { DriverBinding, KindHandler, Plugin } from "agent-runtime-api";
import { createFileOps, type FileDesired } from "../infrastructure/file-ops.js";
import {
  createMcpEntryStateStore,
  type McpEntryStateStore,
} from "../infrastructure/mcp-entry-state-store.js";

const IMPL_NAME = "mcp-entry";
const DEFAULT_KEY_PATH = "mcpServers";

// MCP config is always a JSON object merged under `keyPath` — format and merge
// strategy are intrinsic to the kind, not per-binding knobs.
const bindingSchema = z.object({
  impl: z.literal(IMPL_NAME),
  path: z.string().min(1),
  keyPath: z.string().optional(),
});

export function createMcpEntryPlugin(): Plugin {
  const fileOps = createFileOps();

  return {
    name: IMPL_NAME,

    bind(kind: string, binding: DriverBinding): KindHandler {
      if (kind !== "mcp-entry") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle kind "${kind}" — bind it to "mcp-entry" only`,
        );
      }
      const parsed = bindingSchema.safeParse(binding);
      if (!parsed.success) {
        throw new Error(
          `plugin "${IMPL_NAME}" invalid binding: ${parsed.error.message}`,
        );
      }
      const { path, keyPath } = parsed.data;
      const effectiveKey = keyPath ?? DEFAULT_KEY_PATH;
      let stateStore: McpEntryStateStore | undefined;

      return async (contributions, ctx) => {
        stateStore ??= createMcpEntryStateStore(ctx.pluginStateDir);
        const installed = new Set(stateStore.getInstalled());

        const entries: Record<string, unknown> = {};
        for (const c of contributions) {
          if (c.kind !== "mcp-entry") continue;
          entries[c.name] = {
            type: "http",
            url: c.url,
            ...(c.headers ? { headers: c.headers } : {}),
          };
        }
        const names = Object.keys(entries);
        const targetPath = expandHome(path, ctx.agentHome);

        // Preserve user-added servers: start from what's on disk, drop only the
        // servers this driver installed before that are no longer desired, then
        // set the desired ones. Anything the user added stays untouched.
        const segs = effectiveKey.split(".");
        const next = { ...readKeyedObject(targetPath, segs) };
        for (const name of installed) {
          if (!(name in entries)) delete next[name];
        }
        Object.assign(next, entries);

        ctx.log(
          `desired entries (${names.length}): ${names.length === 0 ? "<none>" : names.join(", ")}; preserved ${Object.keys(next).length - names.length} other server(s)`,
        );
        const content: Record<string, unknown> = keyPath
          ? next
          : { [effectiveKey]: next };
        ctx.log(`writing → ${targetPath} (keyPath=${effectiveKey})`);
        const desired = new Map<string, FileDesired[]>([
          [
            targetPath,
            [
              {
                format: "json",
                mergeMode: "key-targeted",
                content,
                ...(keyPath ? { keyPath } : {}),
              },
            ],
          ],
        ]);
        await fileOps.apply(desired as Map<string, FileDesired[] | null>, {
          agentHome: ctx.agentHome,
          log: ctx.log,
        });
        stateStore.setInstalled(names);
      };
    },
  };
}

function expandHome(path: string, agentHome: string): string {
  return path.replace(/\$HOME\b/g, agentHome).replace(/\$\{HOME\}/g, agentHome);
}

// Reads the object at `segs` from a JSON file, or {} if missing/unreadable.
function readKeyedObject(
  targetPath: string,
  segs: string[],
): Record<string, unknown> {
  try {
    if (!existsSync(targetPath)) return {};
    let cur: unknown = JSON.parse(readFileSync(targetPath, "utf8"));
    for (const s of segs) {
      if (!cur || typeof cur !== "object") return {};
      cur = (cur as Record<string, unknown>)[s];
    }
    return cur && typeof cur === "object"
      ? (cur as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const MCP_ENTRY_PLUGIN_NAME = IMPL_NAME;
