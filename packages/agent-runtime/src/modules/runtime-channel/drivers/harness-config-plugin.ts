import { existsSync, readFileSync } from "node:fs";
import type {
  DriverBinding,
  EventHandler,
  HarnessConfigCurrent,
  HarnessConfigEventPayload,
  HarnessConfigReport,
  HarnessConfigValues,
  Plugin,
} from "agent-runtime-api";
import { parseFile } from "../infrastructure/file-codec.js";
import {
  createFileOps,
  getNested,
  type FileDesired,
} from "../infrastructure/file-ops.js";
import type {
  ModelDiscovery,
  ModelDiscoveryOutcome,
} from "../infrastructure/model-discovery.js";
import type { HarnessConfigBinding } from "../manifest.js";
import { expandHome } from "../../../core/expand-home.js";
import type { RuntimeEnvReader } from "../../../core/runtime-env.js";

const IMPL_NAME = "harness-config";

export type ApplyHarnessConfigFn = (
  payload: HarnessConfigEventPayload,
) => Promise<void>;

// The harness-config plugin: present (catalog on hello), read (current values +
// discovered models), and apply (one-shot write) a harness's model/mode/config
// defaults in its own config file. See docs/architecture/connections.md.
export interface HarnessConfigPlugin extends Plugin {
  readonly supported: boolean;
  readonly catalog: HarnessConfigBinding["catalog"];
  /** The config file alone — no discovery, so no network call. This is what
   *  `hello` reports: it must not block boot on the provider. */
  readValues(): HarnessConfigValues;
  /** For the live UI read: an unresolvable model list collapses to null so the
   *  panel falls back to the static catalog. */
  readCurrent(): Promise<HarnessConfigCurrent>;
  /** For the durable snapshot: distinguishes a list the provider actually
   *  answered with from one this attempt simply couldn't resolve. `availableModels`
   *  is absent in the latter case, so the recorded list survives. */
  readReport(): Promise<HarnessConfigReport>;
  apply: ApplyHarnessConfigFn;
}

export function createHarnessConfigPlugin(deps: {
  binding: HarnessConfigBinding | undefined;
  agentHome: string;
  // Materialized connection env (the env driver's output), not process.env —
  // discovery reads the proxy base URL from here.
  envReader: RuntimeEnvReader;
  discoverModels: ModelDiscovery;
  log: (msg: string) => void;
}): HarnessConfigPlugin {
  const { binding, agentHome, envReader, discoverModels, log } = deps;
  const fileOps = createFileOps();

  const apply: ApplyHarnessConfigFn = async (payload) => {
    if (!binding) {
      log(`[harness-config] no harnessConfig in manifest — skipping`);
      return;
    }
    const { keys, format } = binding;

    const toSet = new Map<string, string>();
    if (payload.model !== undefined && keys.model)
      toSet.set(keys.model, payload.model);
    if (payload.mode !== undefined && keys.mode)
      toSet.set(keys.mode, payload.mode);
    for (const [id, value] of Object.entries(payload.configOptions ?? {})) {
      const keyPath = keys.configOptions?.[id];
      if (keyPath) toSet.set(keyPath, value);
      else log(`[harness-config] no key mapping for "${id}" — skipping`);
    }
    const toUnset: string[] = [];
    for (const field of payload.unset ?? []) {
      const keyPath = keyPathFor(field, keys);
      if (keyPath) toUnset.push(keyPath);
      else log(`[harness-config] no key mapping for "${field}" — skipping`);
    }

    if (toSet.size === 0 && toUnset.length === 0) {
      log(`[harness-config] nothing mapped to apply`);
      return;
    }

    const targetPath = expandHome(binding.file, agentHome);
    const fragments: FileDesired[] = [
      ...toUnset.map((keyPath) => ({
        format,
        mergeMode: "key-targeted" as const,
        keyPath,
        content: undefined,
        delete: true,
      })),
      ...[...toSet].map(([keyPath, content]) => ({
        format,
        mergeMode: "key-targeted" as const,
        keyPath,
        content,
      })),
    ];

    log(
      `[harness-config] → ${targetPath} (${format}): set ${[...toSet.keys()].join(", ") || "<none>"}${toUnset.length ? `; unset ${toUnset.join(", ")}` : ""}`,
    );
    await fileOps.apply(new Map([[targetPath, fragments]]), {
      agentHome,
      log,
      onUnparseable: "throw",
    });
  };

  const readValues = (): HarnessConfigValues =>
    binding
      ? readCurrentValues(binding, agentHome, log)
      : { model: null, mode: null, configOptions: {} };

  // Discover even when the file is missing, so a fresh agent still lists models.
  const discover = async (): Promise<ModelDiscoveryOutcome> =>
    binding
      ? await discoverModels(binding.modelDiscovery, envReader.current())
      : { status: "not-configured" };

  const readCurrent = async (): Promise<HarnessConfigCurrent> => {
    const outcome = await discover();
    return {
      ...readValues(),
      availableModels: outcome.status === "observed" ? outcome.models : null,
    };
  };

  const readReport = async (): Promise<HarnessConfigReport> => {
    const values = readValues();
    const outcome = await discover();
    switch (outcome.status) {
      case "observed":
        return { ...values, availableModels: outcome.models };
      case "not-configured":
        // A permanent property of this harness, so worth recording as "none".
        return { ...values, availableModels: null };
      case "unavailable":
        // Omitted, not null: the server keeps whatever it already holds.
        return values;
    }
  };

  return {
    name: IMPL_NAME,
    supported: binding !== undefined,
    catalog: binding?.catalog,
    readValues,
    readCurrent,
    readReport,
    apply,
    // Binding already captured above; the registry routes the event here.
    bindEvent(_kind: string, _binding: DriverBinding): EventHandler {
      return async (payload) => apply(payload as HarnessConfigEventPayload);
    },
  };
}

function readCurrentValues(
  binding: HarnessConfigBinding,
  agentHome: string,
  log: (msg: string) => void,
): HarnessConfigValues {
  const empty: HarnessConfigValues = {
    model: null,
    mode: null,
    configOptions: {},
  };
  const path = expandHome(binding.file, agentHome);
  if (!existsSync(path)) return empty;
  let obj: Record<string, unknown>;
  try {
    const parsed = parseFile(binding.format, readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return empty;
    }
    obj = parsed as Record<string, unknown>;
  } catch (err) {
    log(`[harness-config] read failed for ${path}: ${(err as Error).message}`);
    return empty;
  }

  const asString = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  const { keys } = binding;
  const configOptions: Record<string, string> = {};
  for (const [id, keyPath] of Object.entries(keys.configOptions ?? {})) {
    const v = getNested(obj, keyPath.split("."));
    if (typeof v === "string") {
      configOptions[id] = v;
    }
  }
  return {
    model: keys.model ? asString(getNested(obj, keys.model.split("."))) : null,
    mode: keys.mode ? asString(getNested(obj, keys.mode.split("."))) : null,
    configOptions,
  };
}

function keyPathFor(
  field: string,
  keys: HarnessConfigBinding["keys"],
): string | undefined {
  if (field === "model") return keys.model;
  if (field === "mode") return keys.mode;
  return keys.configOptions?.[field];
}
