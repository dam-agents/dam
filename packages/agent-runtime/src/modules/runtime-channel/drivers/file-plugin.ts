import { join } from "node:path";
import { match } from "ts-pattern";
import { z } from "zod";
import {
  fileFormat,
  mergeMode,
  type DriverBinding,
  type KindHandler,
  type Plugin,
} from "agent-runtime-api";
import { applyFiles, type FileDesired } from "../infrastructure/file-ops.js";
import {
  openJsonFile,
  type DocumentStore,
} from "../../../core/document-store.js";
import { expandHome } from "../../../core/expand-home.js";

const IMPL_NAME = "file";

const writtenPath = z.object({
  format: fileFormat,
  mergeMode,
  keys: z.array(z.string()).catch([]).default([]),
});
type WrittenPath = z.infer<typeof writtenPath>;

const stateSchema = z.object({
  written: z.record(z.string(), writtenPath).catch({}).default({}),
});
type FileState = z.infer<typeof stateSchema>;

function topLevelKeys(content: unknown): string[] {
  if (
    content === null ||
    typeof content !== "object" ||
    Array.isArray(content)
  ) {
    return [];
  }
  return Object.keys(content as Record<string, unknown>);
}

function staleKeysOf(previous: WrittenPath, current: WrittenPath): string[] {
  if (
    previous.mergeMode !== "key-targeted" ||
    current.mergeMode !== "key-targeted"
  ) {
    return [];
  }
  return previous.keys.filter((key) => !current.keys.includes(key));
}

function removalOf(record: WrittenPath): FileDesired[] | null | "keep" {
  const strip: FileDesired = {
    format: record.format,
    mergeMode: record.mergeMode,
    content: undefined,
    delete: true,
  };
  return match(record.mergeMode)
    .with("overwrite", () => null)
    .with("section-marker", () => [strip])
    .with("key-targeted", () => [{ ...strip, keys: record.keys }])
    .with("yaml-fill-if-missing", () => "keep" as const)
    .exhaustive(() => "keep" as const);
}

export function createFilePlugin(): Plugin {
  return {
    name: IMPL_NAME,

    bind(kind: string, _binding: DriverBinding): KindHandler {
      if (kind !== "file") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle kind "${kind}" — bind it to "file" only`,
        );
      }
      let stateStore: DocumentStore<FileState> | undefined;
      return async (contributions, ctx) => {
        stateStore ??= openJsonFile(
          join(ctx.pluginStateDir, "file-state.json"),
          { schema: stateSchema, initial: () => ({ written: {} }) },
        );
        const written = stateStore.read().written;

        const fragments = new Map<string, FileDesired[]>();
        const next: Record<string, WrittenPath> = {};
        for (const c of contributions) {
          if (c.kind !== "file") continue;
          const path = expandHome(c.path, ctx.agentHome);
          const list = fragments.get(path) ?? [];
          list.push({
            format: c.format,
            mergeMode: c.mergeMode,
            content: c.content,
          });
          fragments.set(path, list);
          const record = next[path] ?? {
            format: c.format,
            mergeMode: c.mergeMode,
            keys: [],
          };
          if (c.mergeMode === "key-targeted") {
            record.keys = [
              ...new Set([...record.keys, ...topLevelKeys(c.content)]),
            ];
          }
          next[path] = record;
        }

        const desired = new Map<string, FileDesired[] | null>(fragments);
        for (const [path, record] of Object.entries(written)) {
          const kept = next[path];
          if (kept) {
            const stale = staleKeysOf(record, kept);
            if (stale.length > 0) {
              desired.set(path, [
                {
                  format: record.format,
                  mergeMode: record.mergeMode,
                  content: undefined,
                  delete: true,
                  keys: stale,
                },
                ...(fragments.get(path) ?? []),
              ]);
            }
            continue;
          }
          const removal = removalOf(record);
          if (removal === "keep") {
            ctx.log(
              `[file] ${path}: ${record.mergeMode} only adds, so the file is left as it is`,
            );
            continue;
          }
          desired.set(path, removal);
        }

        await applyFiles(desired, { agentHome: ctx.agentHome, log: ctx.log });
        stateStore.write({ written: next });
      };
    },
  };
}
