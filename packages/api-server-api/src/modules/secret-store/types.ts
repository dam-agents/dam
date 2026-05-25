import { z } from "zod";

/**
 * Opaque, store-agnostic handle to a secret value (ADR-051's auth shape uses
 * these as `refreshTokenRef`, `accessToken`, `valueRef`, ...). The adapter
 * behind the SecretStore port is responsible for translating `path` + `field`
 * into its native concept (K8s Secret name + key; Vault KV path + key; AWS
 * SM ARN + JSON key).
 *
 * Callers never construct `path` themselves — they ask the SecretStore for a
 * new ref via a factory (`mintRef`) so the naming convention stays inside the
 * adapter.
 */
export const secretRef = z.object({
  /**
   * Logical store identifier. Absent means "the default store" — single-
   * store deployments leave this blank. Multi-store deployments (e.g.
   * customer-managed Vault alongside platform K8s Secrets) set this and
   * route via the SecretStoreRegistry.
   */
  storeId: z.string().optional(),

  /**
   * Store-interpreted path. The adapter knows its own grammar — K8s reads
   * this as a Secret name in the api-server's namespace; Vault as a KV
   * path; AWS Secrets Manager as a secret name or ARN.
   */
  path: z.string().min(1),

  /**
   * Key within the secret payload. All three of K8s / Vault KV /
   * AWS SM support multi-field secrets natively; the adapter maps 1:1.
   */
  field: z.string().min(1),
});

export type SecretRef = z.infer<typeof secretRef>;
