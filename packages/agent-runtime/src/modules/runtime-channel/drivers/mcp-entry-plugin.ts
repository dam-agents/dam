import { z } from "zod";
import type {
  DriverBinding,
  FileFormat,
  KindHandler,
  MergeMode,
  Plugin,
} from "agent-runtime-api";
import { createFileOps, type FileDesired } from "../infrastructure/file-ops.js";

/**
 * Built-in `mcp-entry` plugin (ADR-052). Binds the `mcp-entry`
 * Contribution kind to one configured file on disk (Claude Code reads
 * `$HOME/.mcp.json` by default; other harnesses can rebind to a
 * different path).
 *
 * Binding config:
 *   path:      target file (supports $HOME / ${HOME} expansion)
 *   format:    yaml | json | text | ini
 *   mergeMode: overwrite | section-marker | key-targeted | yaml-fill-if-missing
 *   keyPath:   optional dotted prefix the entries land under (default
 *              `mcpServers`).
 *
 * Manifest:
 *   drivers:
 *     mcp-entry:
 *       impl: mcp-entry
 *       path: "$HOME/.mcp.json"
 *       format: json
 *       mergeMode: key-targeted
 *       keyPath: mcpServers
 */
const IMPL_NAME = "mcp-entry";
const DEFAULT_KEY_PATH = "mcpServers";

const bindingSchema = z.object({
  impl: z.literal(IMPL_NAME),
  path: z.string().min(1),
  format: z.enum(["yaml", "json", "text", "ini"]),
  mergeMode: z.enum([
    "overwrite",
    "section-marker",
    "key-targeted",
    "yaml-fill-if-missing",
  ]),
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
      const { path, format, mergeMode, keyPath } = parsed.data;
      const effectiveKey = keyPath ?? DEFAULT_KEY_PATH;

      return async (contributions, ctx) => {
        const entries: Record<string, unknown> = {};
        for (const c of contributions) {
          if (c.kind !== "mcp-entry") continue;
          entries[c.name] = {
            type: "http",
            url: c.url,
            ...(c.headers ? { headers: c.headers } : {}),
          };
        }
        const content: Record<string, unknown> = keyPath
          ? entries
          : { [effectiveKey]: entries };
        const targetPath = expandHome(path, ctx.agentHome);
        const desired = new Map<string, FileDesired[]>([
          [
            targetPath,
            [
              {
                format: format as FileFormat,
                mergeMode: mergeMode as MergeMode,
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
      };
    },
  };
}

function expandHome(path: string, agentHome: string): string {
  return path.replace(/\$HOME\b/g, agentHome).replace(/\$\{HOME\}/g, agentHome);
}

export const MCP_ENTRY_PLUGIN_NAME = IMPL_NAME;
