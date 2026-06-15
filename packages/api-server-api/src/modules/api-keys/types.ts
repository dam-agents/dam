import type { z } from "zod";
import type {
  apiKeyCreateInputSchema,
  apiKeyRevokeInputSchema,
  scopeSchema,
} from "./schemas.js";

// Single source of truth for the scope vocabulary lives in schemas.ts so the
// Zod enum and these arrays can never drift apart.
export { AGENT_SCOPES, ALL_SCOPES, CREDENTIAL_SCOPES } from "./schemas.js";

export type Scope = z.infer<typeof scopeSchema>;

export type AgentBinding = readonly string[] | "*";

export interface ApiKeyView {
  id: string;
  name: string;
  scopes: readonly Scope[];
  agentIds: AgentBinding;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateInputSchema>;
export type ApiKeyRevokeInput = z.infer<typeof apiKeyRevokeInputSchema>;

export interface ApiKeyCreateResult {
  key: ApiKeyView;
  /** Plaintext token. Returned ONCE on create; never persisted, never recoverable. */
  plaintext: string;
}

export interface ApiKeysService {
  list(): Promise<ApiKeyView[]>;
  create(input: ApiKeyCreateInput): Promise<ApiKeyCreateResult>;
  revoke(id: string): Promise<void>;
}

/** Token prefix that distinguishes an API key from a Keycloak JWT in the
 *  shared `Authorization: Bearer` slot. Brand-neutral on purpose — `platform`
 *  is the codename in the codebase, so `pk_` ("platform key") is permanent and
 *  survives any rebrand of the user-visible product name. */
export const API_KEY_PREFIX = "pk_";
