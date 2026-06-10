/**
 * Idempotent boot sweep: drop the Claude Code model pins that pre-gateway
 * saves of the IBM LiteLLM preset snapshotted into secrets — the model
 * gateway (ADR-066) serves tier defaults assign-if-unset, so a stored pin
 * would mask live discovery forever (#702). Only `ibm-litellm` secrets: the
 * same var in a generic/custom provider is a deliberate choice and must
 * keep winning.
 */
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  LABEL_MANAGED_BY,
  LABEL_SECRET_TYPE,
  readEnvMappings,
  writeEnvMappings,
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
    const mappings = readEnvMappings(secret.metadata?.annotations);
    if (!name || !mappings) continue;
    const kept = mappings.filter((m) => !PIN_ENV_VARS.has(m?.envName));
    if (kept.length === mappings.length) continue;
    const annotations = { ...secret.metadata!.annotations };
    writeEnvMappings(annotations, kept);
    await client.replaceSecret(name, {
      ...secret,
      metadata: { ...secret.metadata, annotations },
    });
    patched++;
  }
  return patched;
}
