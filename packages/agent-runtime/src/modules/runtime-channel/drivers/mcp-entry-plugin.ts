import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { DriverBinding, KindHandler, Plugin } from "agent-runtime-api";
import { parseFile } from "../infrastructure/file-codec.js";
import { createFileOps, type FileDesired } from "../infrastructure/file-ops.js";
import {
  createMcpEntryStateStore,
  type McpEntryStateStore,
} from "../infrastructure/mcp-entry-state-store.js";
import { expandHome } from "../../../core/expand-home.js";

const IMPL_NAME = "mcp-entry";
const DEFAULT_KEY_PATH = "mcpServers";
const DEFAULT_HEADERS_KEY = "headers";

function ownedKeys(
  urlKey: string | undefined,
  headersKey: string | undefined,
): string[] {
  return [
    headersKey ?? DEFAULT_HEADERS_KEY,
    ...(urlKey ? [urlKey] : ["type", "url"]),
  ];
}

const bindingSchema = z
  .object({
    impl: z.literal(IMPL_NAME),
    path: z.string().min(1),
    format: z.enum(["json", "toml"]).default("json"),
    keyPath: z.string().optional(),
    urlKey: z.string().min(1).optional(),
    headersKey: z.string().min(1).optional(),
    extraFields: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((b, ctx) => {
    const reserved = new Set(ownedKeys(b.urlKey, b.headersKey));
    for (const key of Object.keys(b.extraFields ?? {})) {
      if (reserved.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["extraFields", key],
          message: `"${key}" is built by the driver and cannot be set via extraFields`,
        });
      }
    }
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
      const { path, format, keyPath, urlKey, headersKey, extraFields } =
        parsed.data;
      const effectiveKey = keyPath ?? DEFAULT_KEY_PATH;
      const effectiveHeadersKey = headersKey ?? DEFAULT_HEADERS_KEY;
      let stateStore: McpEntryStateStore | undefined;

      return async (contributions, ctx) => {
        stateStore ??= createMcpEntryStateStore(ctx.pluginStateDir);
        const installed = new Set(stateStore.getInstalled());

        const entries: Record<string, unknown> = {};
        for (const c of contributions) {
          if (c.kind !== "mcp-entry") continue;
          entries[c.name] = {
            ...(urlKey ? { [urlKey]: c.url } : { type: "http", url: c.url }),
            ...(c.headers ? { [effectiveHeadersKey]: c.headers } : {}),
            ...extraFields,
          };
        }
        const names = Object.keys(entries);
        const targetPath = expandHome(path, ctx.agentHome);

        const segs = effectiveKey.split(".");
        const next = { ...readKeyedObject(targetPath, format, segs) };
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
                format,
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

function readKeyedObject(
  targetPath: string,
  format: "json" | "toml",
  segs: string[],
): Record<string, unknown> {
  try {
    if (!existsSync(targetPath)) return {};
    let cur: unknown = parseFile(format, readFileSync(targetPath, "utf8"));
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
