import {
  CLAUDE_TIERS,
  chatModels,
  compareModelVersions,
  newestOfTier,
} from "agent-runtime-api";
import { aliasOrder, HARNESS_HOME_PROVIDERS } from "api-server-api";
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

const ROUTER_PLACEHOLDER = "platform:conn:router";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code's tier slots, which its picker and
 * `/model` offer, each filled with the newest model carrying the tier word,
 * so a provider that serves no Claude model still answers every slot with
 * one of its own.
 */
export function tierModels(
  candidates: readonly string[],
): Record<(typeof CLAUDE_TIERS)[number], string> | null {
  const ids = chatModels(candidates);
  if (ids.length === 0) return null;
  const [fable, opus, sonnet, haiku] = CLAUDE_TIERS.map((t) =>
    newestOfTier(ids, t),
  );
  const fallback =
    opus ?? sonnet ?? haiku ?? [...ids].sort(compareModelVersions).at(-1)!;
  return {
    fable: fable ?? fallback,
    opus: fallback,
    sonnet: sonnet ?? fallback,
    haiku: haiku ?? sonnet ?? fallback,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the env a harness process gets so it runs on the
 * Model Router. CLAUDE_CODE_MAX_CONTEXT_TOKENS is the smallest window among
 * the models Claude Code may run on, since it reads the window per process,
 * not per model. A credential variable the manifest names gets the router's
 * placeholder because the client will not start without one. Provider env
 * never reaches a harness process, so PLATFORM_MODEL_ROUTER_SERVES is what
 * an image script keys on to point its harness at the router.
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
  if (binding.bobGateway) {
    env.BOB_GATEWAY_URL = env.PLATFORM_MODEL_ROUTER_URL;
    env.BOBSHELL_API_KEY = ROUTER_PLACEHOLDER;
    const first = defaultProvider?.entries[0];
    const home = HARNESS_HOME_PROVIDERS[input.harness] ?? [];
    if (first && !home.includes(first.alias))
      env.PLATFORM_BOB_DEFAULT_MODEL = renderName(first, binding);
  }
  if (!binding.claudeTiers) return env;
  if (defaultProvider) {
    const tiers = tierModels(defaultProvider.entries.map((e) => e.upstreamId));
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
  }
  const windows = serving
    .flatMap((p): CatalogEntry[] => p.entries)
    .map((e) => e.metadata.contextWindow)
    .filter((w): w is number => w !== null && w > 0);
  if (windows.length)
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(Math.min(...windows));
  return env;
}
