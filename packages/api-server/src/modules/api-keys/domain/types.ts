import type { Scope } from "api-server-api";

export interface ApiKeyRow {
  id: string;
  ownerSub: string;
  name: string;
  hash: string;
  scopes: readonly Scope[];
  agentIds: readonly string[] | null;
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export type NewApiKey = Pick<
  ApiKeyRow,
  "id" | "ownerSub" | "name" | "hash" | "scopes" | "agentIds" | "expiresAt"
>;
