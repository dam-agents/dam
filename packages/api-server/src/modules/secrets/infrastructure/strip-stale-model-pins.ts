/**
 * Boot-time sweep: drop the Claude Code model pins that the retired IBM
 * LiteLLM preset snapshotted into saved secrets.
 *
 * The claude-code model gateway (ADR-066) owns model selection now — it
 * discovers the upstream catalog live and writes tier defaults assign-if-unset
 * — so a pin stored in an old secret would permanently mask discovery (the
 * exact staleness of #702, frozen into every pre-gateway save). Only
 * `ibm-litellm` secrets are touched: the same var in a generic/custom provider
 * is a deliberate user choice and must keep winning.
 *
 * Idempotent; runs on every api-server boot and no-ops once the pins are gone.
 */
import type { EnvMapping } from "api-server-api";

import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  ANN_ENV_MAPPINGS,
  LABEL_MANAGED_BY,
  LABEL_SECRET_TYPE,
} from "./k8s-secrets-port.js";

const PIN_ENV_VARS = new Set([
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
]);

/** Returns the number of secrets patched. */
export async function stripStaleModelPins(
  client: Pick<K8sClient, "listSecrets" | "replaceSecret">,
): Promise<number> {
  const secrets = await client.listSecrets(
    `${LABEL_SECRET_TYPE}=ibm-litellm,${LABEL_MANAGED_BY}=api-server`,
  );
  let patched = 0;
  for (const secret of secrets) {
    const name = secret.metadata?.name;
    const raw = secret.metadata?.annotations?.[ANN_ENV_MAPPINGS];
    if (!name || !raw) continue;
    let mappings: EnvMapping[];
    try {
      mappings = JSON.parse(raw);
    } catch {
      continue; // malformed annotation — not this sweep's problem
    }
    if (!Array.isArray(mappings)) continue;
    const kept = mappings.filter((m) => !PIN_ENV_VARS.has(m?.envName));
    if (kept.length === mappings.length) continue;
    const annotations = { ...secret.metadata!.annotations };
    if (kept.length) annotations[ANN_ENV_MAPPINGS] = JSON.stringify(kept);
    else delete annotations[ANN_ENV_MAPPINGS];
    await client.replaceSecret(name, {
      ...secret,
      metadata: { ...secret.metadata, annotations },
    });
    patched++;
  }
  return patched;
}
