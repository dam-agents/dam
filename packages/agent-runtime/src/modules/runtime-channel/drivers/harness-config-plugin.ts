import { existsSync, readFileSync } from "node:fs";
import type {
  DriverBinding,
  EventHandler,
  HarnessConfigChoice,
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
import type { LeaseEnvReader } from "../../../core/runtime-env.js";

const IMPL_NAME = "harness-config";

export interface SeedListingRetry {
  attempts: number;
  delayMs: number;
}

export const SEED_LISTING_RETRY: SeedListingRetry = {
  attempts: 5,
  delayMs: 2_000,
};

export type ApplyHarnessConfigFn = (
  payload: HarnessConfigEventPayload,
) => Promise<void>;

export interface HarnessConfigPlugin extends Plugin {
  readonly supported: boolean;
  readonly catalog: HarnessConfigBinding["catalog"];
  readonly sessionModel: boolean;
  readCurrent(opts?: { discover?: boolean }): Promise<HarnessConfigCurrent>;
  models(
    provider: string | null,
  ): Promise<HarnessConfigChoice[] | null | undefined>;
  apply: ApplyHarnessConfigFn;
  seedModel(): Promise<boolean>;
  leaseModel(provider: string | null): Promise<string | null>;
}

export function createHarnessConfigPlugin(deps: {
  harness: string;
  binding: HarnessConfigBinding | undefined;
  agentHome: string;
  envReader: LeaseEnvReader;
  discoverModels: ModelDiscovery;
  seedListingRetry: SeedListingRetry;
  onApplied?: () => void;
  log: (msg: string) => void;
}): HarnessConfigPlugin {
  const { binding, agentHome, envReader, discoverModels, log } = deps;
  const envOf = (provider: string | null): Record<string, string> =>
    envReader.forLease({ harness: deps.harness, provider });
  const defaultEnv = (): Record<string, string> =>
    envOf(envReader.providers()[0] ?? null);
  const seedRetry = deps.seedListingRetry;

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

  const listModels = async (
    env: Record<string, string>,
  ): Promise<HarnessConfigChoice[] | null | undefined> => {
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

  const listUntilAnswered = async (
    env: Record<string, string>,
  ): Promise<ModelDiscoveryOutcome> => {
    for (let attempt = 1; ; attempt++) {
      const outcome = await discoverModels(binding?.modelDiscovery, env);
      if (outcome.status !== "unavailable" || attempt >= seedRetry.attempts)
        return outcome;
      log(
        `[harness-config] model listing unavailable — asking again in ${seedRetry.delayMs}ms (${attempt}/${seedRetry.attempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, seedRetry.delayMs));
    }
  };

  const seedModel = async (): Promise<boolean> => {
    if (!binding?.modelDiscovery || !binding.keys.model) return false;
    const env = defaultEnv();
    const source = selectDiscoverySource(binding.modelDiscovery, env);
    if (!source) return false;
    if (!source.spec.redirectEnv?.includes(source.via)) {
      log(
        `[harness-config] no model seeded: ${source.via} supplies the harness's own endpoint`,
      );
      return false;
    }
    const pinned = source.spec.pinEnv?.find((name) => !!env[name]?.trim());
    const current = readCurrentValues(binding, agentHome, log).model;
    const standing = current ?? (pinned ? env[pinned]?.trim() : undefined);

    const outcome = await listUntilAnswered(env);
    if (outcome.status !== "observed" || outcome.via !== source.via)
      return false;
    const listed = (model: string | undefined): boolean =>
      outcome.models.some((m) => m.value === model);
    if (standing && listed(standing)) {
      if (!current)
        log(`[harness-config] no model seeded: ${pinned} pins one already`);
      return false;
    }
    if (current && pinned && listed(env[pinned]?.trim())) {
      log(
        `[harness-config] ${current} is not served via ${outcome.via}; leaving the model to ${pinned}`,
      );
      await apply({ unset: ["model"] });
      return true;
    }
    const model = outcome.models[0]?.value;
    if (!model) return false;
    log(
      standing
        ? `[harness-config] ${standing} is not served via ${outcome.via}; seeding model ${model}`
        : `[harness-config] seeding model ${model} (via ${outcome.via})`,
    );
    await apply({ model });
    return true;
  };

  const leaseModel = async (
    provider: string | null,
  ): Promise<string | null> => {
    if (!binding?.modelDiscovery) return null;
    const env = envOf(provider);
    const source = selectDiscoverySource(binding.modelDiscovery, env);
    const pinned = source?.spec.pinEnv
      ?.map((name) => env[name]?.trim())
      .find((value) => !!value);
    if (pinned) return pinned;
    const outcome = await listUntilAnswered(env);
    if (outcome.status !== "observed") return null;
    if (!source?.spec.redirectEnv?.includes(outcome.via)) return null;
    return outcome.models[0]?.value ?? null;
  };

  return {
    name: IMPL_NAME,
    supported: binding !== undefined,
    catalog: binding?.catalog,
    sessionModel: binding?.sessionModel === true,
    readCurrent,
    models: (provider) => listModels(envOf(provider)),
    apply,
    seedModel,
    leaseModel,
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
