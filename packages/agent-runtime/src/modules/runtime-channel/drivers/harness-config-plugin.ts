import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DriverBinding,
  EventHandler,
  HarnessConfigChoice,
  HarnessConfigCurrent,
  HarnessConfigEventPayload,
  Plugin,
} from "agent-runtime-api";
import { harnessConfigChoice } from "agent-runtime-api";
import { z } from "zod";
import { openJsonFile } from "../../../core/document-store.js";
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
import type { LeaseEnvReader } from "../../../core/runtime-env.js";

const IMPL_NAME = "harness-config";

export type ApplyHarnessConfigFn = (
  payload: HarnessConfigEventPayload,
) => Promise<void>;

export interface HarnessConfigPlugin extends Plugin {
  readonly supported: boolean;
  readonly catalog: HarnessConfigBinding["catalog"];
  readonly sessionModel: boolean;
  readonly sessionSettings: string[] | undefined;
  readonly derivedStartMode: string[] | undefined;
  readCurrent(opts?: { discover?: boolean }): Promise<HarnessConfigCurrent>;
  writeModelWindows(
    models: readonly { name: string; contextWindow: number | null }[],
  ): Promise<void>;
  models(
    provider: string | null,
  ): Promise<HarnessConfigChoice[] | null | undefined>;
  apply: ApplyHarnessConfigFn;
}

export function createHarnessConfigPlugin(deps: {
  harness: string;
  binding: HarnessConfigBinding | undefined;
  agentHome: string;
  envReader: LeaseEnvReader;
  discoverModels: ModelDiscovery;
  catalogModels?: () => HarnessConfigChoice[] | null;
  onApplied?: () => void;
  onListingChanged?: () => void;
  log: (msg: string) => void;
}): HarnessConfigPlugin {
  const { binding, agentHome, envReader, log } = deps;
  const listings = openJsonFile(
    join(agentHome, ".platform", "model-listings", `${deps.harness}.json`),
    {
      schema: z.record(
        z.string(),
        z.object({ via: z.string(), models: z.array(harnessConfigChoice) }),
      ),
      initial: () => ({}),
    },
  );
  const listingKey = (env: Record<string, string>): string | undefined => {
    const source = selectDiscoverySource(binding?.modelDiscovery, env);
    return source ? `${source.via}=${source.base}` : undefined;
  };
  const discoverModels: ModelDiscovery = async (spec, env) => {
    const outcome = await deps.discoverModels(spec, env);
    const key = listingKey(env);
    if (outcome.status !== "observed" || !key) return outcome;
    const entry = { via: outcome.via, models: outcome.models };
    const kept = listings.read()[key];
    if (JSON.stringify(kept) === JSON.stringify(entry)) return outcome;
    listings.write({ ...listings.read(), [key]: entry });
    if (kept) deps.onListingChanged?.();
    return outcome;
  };
  const refreshing = new Map<string, Promise<ModelDiscoveryOutcome>>();
  const keptOrDiscovered = async (
    env: Record<string, string>,
  ): Promise<ModelDiscoveryOutcome> => {
    const key = listingKey(env);
    if (!key) return discoverModels(binding?.modelDiscovery, env);
    let pending = refreshing.get(key);
    if (!pending) {
      pending = discoverModels(binding?.modelDiscovery, env).finally(() =>
        refreshing.delete(key),
      );
      refreshing.set(key, pending);
    }
    const kept = listings.read()[key];
    if (!kept) return pending;
    pending.catch((err: unknown) => {
      log(`[harness-config] model refresh failed: ${(err as Error).message}`);
    });
    return { status: "observed", ...kept };
  };
  const envOf = (provider: string | null): Record<string, string> =>
    envReader.forLease({ harness: deps.harness, provider });
  const defaultEnv = (): Record<string, string> =>
    envOf(envReader.providers()[0] ?? null);

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

  const writeModelWindows: HarnessConfigPlugin["writeModelWindows"] = async (
    models,
  ) => {
    const windows = binding?.modelAutoCompactWindow;
    if (!windows || models.length === 0) return;
    const content = Object.fromEntries(
      models.map((m) => [
        m.name,
        { [windows.field]: m.contextWindow ?? windows.unknownWindow },
      ]),
    );
    const targetPath = expandHome(binding.file, agentHome);
    await applyFiles(
      new Map([
        [
          targetPath,
          [
            {
              format: binding.format,
              mergeMode: "key-targeted" as const,
              keyPath: windows.keyPath,
              content,
            },
          ],
        ],
      ]),
      { agentHome, log, onUnparseable: "throw" },
    );
  };

  const harnessDefault = (): string | null => {
    if (binding?.sessionModel !== true) return null;
    const env = defaultEnv();
    const pinned = selectDiscoverySource(binding.modelDiscovery, env)
      ?.spec.pinEnv?.map((name) => env[name]?.trim())
      .find((value) => !!value);
    return pinned ?? binding.defaultModel ?? null;
  };

  const readCurrent = async (opts?: {
    discover?: boolean;
  }): Promise<HarnessConfigCurrent> => {
    const values = {
      ...(binding
        ? readCurrentValues(binding, agentHome, log)
        : { model: null, mode: null, configOptions: {} }),
      defaultModel: harnessDefault(),
    };
    if (opts?.discover === false) return values;
    const availableModels = await listModels(defaultEnv());
    return availableModels === undefined
      ? values
      : { ...values, availableModels };
  };

  const catalogOutcome = (): ModelDiscoveryOutcome | null => {
    const models = deps.catalogModels?.() ?? null;
    if (models === null) return null;
    return models.length === 0
      ? { status: "unavailable" }
      : {
          status: "observed",
          models,
          entries: models.map((m) => ({ id: m.value, name: m.value })),
          via: "model-router",
        };
  };

  const listModels = async (
    env: Record<string, string>,
  ): Promise<HarnessConfigChoice[] | null | undefined> => {
    const outcome: ModelDiscoveryOutcome = !binding
      ? { status: "not-configured" }
      : (catalogOutcome() ??
        (binding.modelDiscovery && !envReader.ready()
          ? { status: "unavailable" }
          : await keptOrDiscovered(env)));
    switch (outcome.status) {
      case "observed": {
        const extendsCatalog = selectDiscoverySource(
          binding?.modelDiscovery,
          env,
        )?.spec.extendsCatalog;
        const catalogModels = extendsCatalog
          ? (
              binding?.catalog?.options.find((o) => o.id === "model")
                ?.choices ?? []
            ).filter((c) =>
              outcome.models.some((m) =>
                m.value.toLowerCase().includes(c.value.toLowerCase()),
              ),
            )
          : [];
        const listed = new Set(catalogModels.map((c) => c.value));
        return [
          ...catalogModels,
          ...outcome.models.filter((m) => !listed.has(m.value)),
        ];
      }
      case "not-configured":
        return null;
      case "unavailable":
        return undefined;
    }
  };

  return {
    name: IMPL_NAME,
    supported: binding !== undefined,
    catalog: binding?.catalog,
    sessionModel: binding?.sessionModel === true,
    sessionSettings: binding?.sessionSettings
      ? Object.keys(binding.sessionSettings)
      : undefined,
    derivedStartMode: derivedStartModeOf(binding),
    readCurrent,
    writeModelWindows,
    models: (provider) => listModels(envOf(provider)),
    apply,
    bindEvent(_kind: string, _binding: DriverBinding): EventHandler {
      return async (payload) => apply(payload as HarnessConfigEventPayload);
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the session settings whose start mode the runtime
 * derives, which the picker needs to show the same mode the session starts in.
 * A harness that does not opt in derives none, so the picker derives none.
 */
function derivedStartModeOf(
  binding: HarnessConfigBinding | undefined,
): string[] | undefined {
  const derived = Object.entries(binding?.sessionSettings ?? {}).flatMap(
    ([id, setting]) =>
      "mode" in setting && setting.deriveStartMode === true ? [id] : [],
  );
  return derived.length === 0 ? undefined : derived;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the values the harness's own config file names,
 * read where a session's settings are synced. A session that picked no mode
 * starts on the mode the file names, because the harness reads it at start,
 * and one that picked no model runs on the model it names, so only a file that
 * names neither leaves the mode to the catalog and the model. A file that
 * cannot be read names nothing, which leaves both to the runtime.
 */
export function readCurrentValues(
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
