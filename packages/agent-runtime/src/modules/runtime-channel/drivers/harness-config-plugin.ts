import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { DriverBinding, KindHandler, Plugin } from "agent-runtime-api";
import {
  createFileOps,
  deleteNested,
  setNested,
  type FileDesired,
} from "../infrastructure/file-ops.js";
import {
  createHarnessConfigStateStore,
  type HarnessConfigStateStore,
} from "../infrastructure/harness-config-state-store.js";
import { expandHome } from "../../../core/expand-home.js";

const IMPL_NAME = "harness-config";

// The binding mirrors the shape of ACP session config — `model`, `mode`, and a
// `configOptions` map keyed by ACP config id — and maps each to a dot-path in
// the harness's own JSON config file. A field/option with no mapping is skipped
// (logged): the driver never guesses where an unmapped value lives. Harnesses
// whose config isn't JSON bind a custom impl instead.
const bindingSchema = z.object({
  impl: z.literal(IMPL_NAME),
  file: z.string().min(1),
  keys: z.object({
    model: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    configOptions: z.record(z.string().min(1), z.string().min(1)).optional(),
  }),
});

export function createHarnessConfigPlugin(): Plugin {
  const fileOps = createFileOps();

  return {
    name: IMPL_NAME,

    bind(kind: string, binding: DriverBinding): KindHandler {
      if (kind !== "harness-config") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle kind "${kind}" — bind it to "harness-config" only`,
        );
      }
      const parsed = bindingSchema.safeParse(binding);
      if (!parsed.success) {
        throw new Error(
          `plugin "${IMPL_NAME}" invalid binding: ${parsed.error.message}`,
        );
      }
      const { file, keys } = parsed.data;
      let stateStore: HarnessConfigStateStore | undefined;

      return async (contributions, ctx) => {
        stateStore ??= createHarnessConfigStateStore(ctx.pluginStateDir);

        // Merge the (at most one) harness-config contribution.
        let model: string | undefined;
        let mode: string | undefined;
        const options: Record<string, string | boolean> = {};
        for (const c of contributions) {
          if (c.kind !== "harness-config") continue;
          if (c.model !== undefined) model = c.model;
          if (c.mode !== undefined) mode = c.mode;
          Object.assign(options, c.configOptions ?? {});
        }

        // Resolve each value to its settings keyPath via the binding, mirroring
        // the ACP config shape. Unmapped fields/options are skipped.
        const desired = new Map<string, string | boolean>();
        if (model !== undefined && keys.model) desired.set(keys.model, model);
        if (mode !== undefined && keys.mode) desired.set(keys.mode, mode);
        for (const [configId, value] of Object.entries(options)) {
          const keyPath = keys.configOptions?.[configId];
          if (!keyPath) {
            ctx.log(`no key mapping for config option "${configId}" — skipping`);
            continue;
          }
          desired.set(keyPath, value);
        }

        const targetPath = expandHome(file, ctx.agentHome);
        const previouslyManaged = stateStore.getManaged();

        // Don't materialize an empty file when there is nothing to write and
        // nothing of ours to clean up.
        if (
          desired.size === 0 &&
          previouslyManaged.length === 0 &&
          !existsSync(targetPath)
        ) {
          return;
        }

        // Reconstruct the whole file: read existing (preserving user keys),
        // drop our managed keys that are no longer desired, set the desired
        // ones, write the full object back via overwrite so removals stick.
        const obj = readJsonObject(targetPath);
        for (const keyPath of previouslyManaged) {
          if (!desired.has(keyPath)) deleteNested(obj, keyPath.split("."));
        }
        for (const [keyPath, value] of desired) {
          setNested(obj, keyPath.split("."), value);
        }

        ctx.log(
          `writing → ${targetPath}: ${desired.size === 0 ? "<none>" : [...desired.keys()].join(", ")}`,
        );
        await fileOps.apply(
          new Map<string, FileDesired[] | null>([
            [
              targetPath,
              [{ format: "json", mergeMode: "overwrite", content: obj }],
            ],
          ]),
          { agentHome: ctx.agentHome, log: ctx.log },
        );
        stateStore.setManaged([...desired.keys()]);
      };
    },
  };
}

// Reads and parses the JSON object at `path`. Missing file → {}. An existing
// file that doesn't parse throws rather than silently clobbering the user's
// hand-edited settings — the apply is recorded as a driver failure and retried.
function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export const HARNESS_CONFIG_PLUGIN_NAME = IMPL_NAME;
