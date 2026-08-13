import type { z } from "zod";
import type {
  apiKeyCreateInputSchema,
  apiKeyRevokeInputSchema,
  scopeSchema,
} from "./schemas.js";

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
  plaintext: string;
}

export interface ApiKeysService {
  list(): Promise<ApiKeyView[]>;
  create(input: ApiKeyCreateInput): Promise<ApiKeyCreateResult>;
  revoke(id: string): Promise<void>;
}

export const API_KEY_PREFIX = "pk_";
