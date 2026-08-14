import { existsSync, readFileSync } from "node:fs";
import type {
  DriverBinding,
  EventHandler,
  HarnessConfigCurrent,
  HarnessConfigEventPayload,
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

export interface HarnessConfigPlugin extends Plugin {
  readonly supported: boolean;
  readonly catalog: HarnessConfigBinding["catalog"];
  readCurrent(opts?: { discover?: boolean }): Promise<HarnessConfigCurrent>;
  apply: ApplyHarnessConfigFn;
}

export function createHarnessConfigPlugin(deps: {
  binding: HarnessConfigBinding | undefined;
  agentHome: string;
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

  const readCurrent = async (opts?: {
    discover?: boolean;
  }): Promise<HarnessConfigCurrent> => {
    const values = binding
      ? readCurrentValues(binding, agentHome, log)
      : { model: null, mode: null, configOptions: {} };
    if (opts?.discover === false) return values;

    const outcome: ModelDiscoveryOutcome = binding
      ? await discoverModels(binding.modelDiscovery, envReader.current())
      : { status: "not-configured" };
    switch (outcome.status) {
      case "observed":
        return { ...values, availableModels: outcome.models };
      case "not-configured":
        return { ...values, availableModels: null };
      case "unavailable":
        return values;
    }
  };

  return {
    name: IMPL_NAME,
    supported: binding !== undefined,
    catalog: binding?.catalog,
    readCurrent,
    apply,
    bindEvent(_kind: string, _binding: DriverBinding): EventHandler {
      return async (payload) => apply(payload as HarnessConfigEventPayload);
    },
  };
}

function readCurrentValues(
  binding: HarnessConfigBinding,
  agentHome: string,
  log: (msg: string) => void,
): Omit<HarnessConfigCurrent, "availableModels"> {
  const empty: Omit<HarnessConfigCurrent, "availableModels"> = {
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
