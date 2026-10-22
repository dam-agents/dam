import {
  aliasOrder,
  HARNESS_HOME_PROVIDERS,
  preferredModelOf,
} from "api-server-api";
import type {
  CatalogEntry,
  CatalogProvider,
} from "../../model-catalog/index.js";
import {
  forHarness,
  renderName,
  servesHarness,
} from "../../model-catalog/index.js";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";
import { tierModels } from "./tier-slots.js";

const ROUTER_PLACEHOLDER = "platform:conn:router";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the env a harness process gets so it runs on the
 * Model Router. CLAUDE_CODE_MAX_CONTEXT_TOKENS is the smallest window among
 * the models Claude Code may run on, since it reads the window per process,
 * not per model. A credential variable the manifest names gets the router's
 * placeholder because the client will not start without one, and a model
 * variable it names gets the default provider's first model for the same
 * reason. Provider env
 * never reaches a harness process, so PLATFORM_MODEL_ROUTER_SERVES is what
 * an image script keys on to point its harness at the router. A harness whose
 * manifest names a classifier variable gets the platform's preferred
 * classifier on the default provider, by its qualified name so the router
 * resolves it without guessing among providers; that is Claude Code's
 * auto-mode permission check, whose own Sonnet slot stays the person's, and a
 * provider that lists no classifier model gets no variable and keeps the
 * harness default.
 */
export function routerEnvFor(input: {
  harness: string;
  binding: ModelRouterBinding | undefined;
  providers: readonly CatalogProvider[];
  port: number;
}): Record<string, string> {
  const { binding, providers, port } = input;
  const env: Record<string, string> = {
    PLATFORM_MODEL_ROUTER_URL: `http://127.0.0.1:${port}`,
    PLATFORM_MODEL_ROUTER_PORT: String(port),
  };
  if (!binding) return env;
  if (providers.some((p) => servesHarness(p, input.harness, binding)))
    env.PLATFORM_MODEL_ROUTER_SERVES = "1";
  for (const name of binding.credentialEnv ?? [])
    env[name] = ROUTER_PLACEHOLDER;
  const serving = providers
    .map((p) => ({
      ...p,
      entries: forHarness(p.entries, input.harness, binding),
    }))
    .filter(
      (p) => p.entries.length > 0 && servesHarness(p, input.harness, binding),
    )
    .sort(
      (a, b) =>
        aliasOrder(a.alias, input.harness) - aliasOrder(b.alias, input.harness),
    );
  const defaultProvider = serving[0];
  const defaultEntry = defaultProvider?.entries[0];
  if (defaultEntry)
    for (const name of binding.defaultModelEnv ?? [])
      env[name] = renderName(defaultEntry, binding);
  if (binding.bobGateway) {
    env.BOB_GATEWAY_URL = env.PLATFORM_MODEL_ROUTER_URL;
    env.BOBSHELL_API_KEY = ROUTER_PLACEHOLDER;
    const first = defaultProvider?.entries[0];
    const home = HARNESS_HOME_PROVIDERS[input.harness] ?? [];
    if (first && !home.includes(first.alias))
      env.PLATFORM_BOB_DEFAULT_MODEL = renderName(first, binding);
  }
  if (defaultProvider) {
    const ids = defaultProvider.entries.map((e) => e.upstreamId);
    const tiers = binding.claudeTiers ? tierModels(ids) : null;
    if (tiers)
      for (const [tier, upstreamId] of Object.entries(tiers)) {
        const entry = defaultProvider.entries.find(
          (e) => e.upstreamId === upstreamId,
        );
        if (entry)
          env[`ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`] = renderName(
            entry,
            binding,
          );
      }
    const classifier = binding.classifierModelEnv
      ? preferredModelOf("classifier", [
          { alias: defaultProvider.alias, listed: ids },
        ])
      : null;
    const classifierEntry = defaultProvider.entries.find(
      (e) => e.upstreamId === classifier?.upstreamId,
    );
    if (binding.classifierModelEnv && classifierEntry)
      env[binding.classifierModelEnv] = renderName(classifierEntry, binding);
  }
  if (!binding.claudeTiers) return env;
  const windows = serving
    .flatMap((p): CatalogEntry[] => p.entries)
    .map((e) => e.metadata.contextWindow)
    .filter((w): w is number => w !== null && w > 0);
  if (windows.length)
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(Math.min(...windows));
  return env;
}
