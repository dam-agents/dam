import { z } from "zod";
import type {
  DriverBinding,
  FileFormat,
  KindHandler,
  MergeMode,
  Plugin,
} from "agent-runtime-api";
import { createFileOps, type FileDesired } from "../infrastructure/file-ops.js";

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
        const names = Object.keys(entries);
        ctx.log(
          `desired entries (${names.length}): ${names.length === 0 ? "<none>" : names.join(", ")}`,
        );
        const content: Record<string, unknown> = keyPath
          ? entries
          : { [effectiveKey]: entries };
        const targetPath = expandHome(path, ctx.agentHome);
        ctx.log(
          `writing → ${targetPath} (format=${format}, mergeMode=${mergeMode}, keyPath=${keyPath ?? "<root>"})`,
        );
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
