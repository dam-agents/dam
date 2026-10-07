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
  applyFiles,
  getNested,
  type FileDesired,
} from "../infrastructure/file-ops.js";
import {
  selectDiscoverySource,
  type ModelDiscovery,
  type ModelDiscoveryOutcome,
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
  readonly sessionModel: boolean;
  readCurrent(opts?: { discover?: boolean }): Promise<HarnessConfigCurrent>;
  apply: ApplyHarnessConfigFn;
  seedModel(): Promise<boolean>;
}

export function createHarnessConfigPlugin(deps: {
  binding: HarnessConfigBinding | undefined;
  agentHome: string;
  envReader: RuntimeEnvReader;
  discoverModels: ModelDiscovery;
  onApplied?: () => void;
  log: (msg: string) => void;
}): HarnessConfigPlugin {
  const { binding, agentHome, envReader, discoverModels, log } = deps;

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
      const keyPaths = optionKeyPaths(keys, id);
      if (keyPaths.length === 0)
        log(`[harness-config] no key mapping for "${id}" — skipping`);
      for (const keyPath of keyPaths) toSet.set(keyPath, value);
    }
    const toUnset: string[] = [];
    for (const field of payload.unset ?? []) {
      const keyPaths = keyPathsFor(field, keys);
      if (keyPaths.length === 0)
        log(`[harness-config] no key mapping for "${field}" — skipping`);
      toUnset.push(...keyPaths);
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
    const before = readCurrentValues(binding, agentHome, log);
    await applyFiles(new Map([[targetPath, fragments]]), {
      agentHome,
      log,
      onUnparseable: "throw",
    });
    const after = readCurrentValues(binding, agentHome, log);
    if (JSON.stringify(before) !== JSON.stringify(after)) deps.onApplied?.();
  };

  const readCurrent = async (opts?: {
    discover?: boolean;
  }): Promise<HarnessConfigCurrent> => {
    const values = binding
      ? readCurrentValues(binding, agentHome, log)
      : { model: null, mode: null, configOptions: {} };
    if (opts?.discover === false) return values;

    const env = envReader.current();
    const outcome: ModelDiscoveryOutcome = !binding
      ? { status: "not-configured" }
      : binding.modelDiscovery && !envReader.ready()
        ? { status: "unavailable" }
        : await discoverModels(binding.modelDiscovery, env);
    switch (outcome.status) {
      case "observed": {
        const extendsCatalog = selectDiscoverySource(
          binding?.modelDiscovery,
          env,
        )?.spec.extendsCatalog;
        const catalogModels = extendsCatalog
          ? (binding?.catalog?.options.find((o) => o.id === "model")?.choices ??
            [])
          : [];
        const listed = new Set(catalogModels.map((c) => c.value));
        return {
          ...values,
          availableModels: [
            ...catalogModels,
            ...outcome.models.filter((m) => !listed.has(m.value)),
          ],
        };
      }
      case "not-configured":
        return { ...values, availableModels: null };
      case "unavailable":
        return values;
    }
  };

  const seedModel = async (): Promise<boolean> => {
    if (!binding?.modelDiscovery || !binding.keys.model) return false;
    const current = readCurrentValues(binding, agentHome, log);
    if (current.model) return false;

    const env = envReader.current();
    const source = selectDiscoverySource(binding.modelDiscovery, env);
    const pinned = source?.spec.pinEnv?.find((name) => !!env[name]?.trim());
    if (pinned) {
      log(`[harness-config] no model seeded: ${pinned} pins one already`);
      return false;
    }

    const outcome = await discoverModels(binding.modelDiscovery, env);
    if (outcome.status !== "observed") return false;
    if (!source?.spec.redirectEnv?.includes(outcome.via)) {
      log(
        `[harness-config] no model seeded: ${outcome.via} supplies the harness's own endpoint`,
      );
      return false;
    }
    const model = outcome.models[0]?.value;
    if (!model) return false;
    log(`[harness-config] seeding model ${model} (via ${outcome.via})`);
    await apply({ model });
    return true;
  };

  return {
    name: IMPL_NAME,
    supported: binding !== undefined,
    catalog: binding?.catalog,
    sessionModel: binding?.sessionModel === true,
    readCurrent,
    apply,
    seedModel,
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
  for (const id of Object.keys(keys.configOptions ?? {})) {
    const [keyPath] = optionKeyPaths(keys, id);
    const v = keyPath && getNested(obj, keyPath.split("."));
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

function keyPathsFor(
  field: string,
  keys: HarnessConfigBinding["keys"],
): string[] {
  if (field === "model") return keys.model ? [keys.model] : [];
  if (field === "mode") return keys.mode ? [keys.mode] : [];
  return optionKeyPaths(keys, field);
}

function optionKeyPaths(
  keys: HarnessConfigBinding["keys"],
  id: string,
): string[] {
  const mapped = keys.configOptions?.[id];
  if (mapped === undefined) return [];
  return typeof mapped === "string" ? [mapped] : [...mapped];
}
