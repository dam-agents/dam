import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  ApiKeyCreateInput,
  ApiKeyCreateResult,
  ApiKeysService,
  ApiKeyView,
  Scope,
} from "api-server-api";
import type { ApiKeyRow } from "../domain/types.js";

const MAX_ACTIVE_KEYS_PER_OWNER = 50;

export interface ApiKeysServiceDeps {
  ownerSub: string;
  list: (ownerSub: string) => Promise<ApiKeyRow[]>;
  insert: (row: {
    id: string;
    ownerSub: string;
    name: string;
    hash: string;
    scopes: readonly Scope[];
    agentIds: readonly string[] | null;
    expiresAt: Date | null;
  }) => Promise<ApiKeyRow>;
  revoke: (id: string, ownerSub: string) => Promise<boolean>;
  mintToken: () => { token: string; hash: string };
  isAgentOwnedBy: (agentId: string, ownerSub: string) => Promise<boolean>;
}

function rowToView(r: ApiKeyRow): ApiKeyView {
  return {
    id: r.id,
    name: r.name,
    scopes: r.scopes,
    agentIds: r.agentIds === null ? "*" : r.agentIds,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  };
}

function generateKeyId(): string {
  return `key-${randomUUID()}`;
}

export function createApiKeysService(deps: ApiKeysServiceDeps): ApiKeysService {
  return {
    async list() {
      const rows = await deps.list(deps.ownerSub);
      return rows.map(rowToView);
    },

    async create(input: ApiKeyCreateInput): Promise<ApiKeyCreateResult> {
      const existing = await deps.list(deps.ownerSub);
      if (existing.length >= MAX_ACTIVE_KEYS_PER_OWNER) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Maximum ${MAX_ACTIVE_KEYS_PER_OWNER} active API keys per owner. Revoke an unused one first.`,
        });
      }

      if (input.scopes.includes("agents:manage") && input.agentIds !== "*") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "agents:manage keys must be unrestricted — remove the agent binding or drop agents:manage.",
        });
      }

      const agentIds: readonly string[] | null =
        input.agentIds === "*" ? null : input.agentIds;

      if (agentIds !== null) {
        for (const id of agentIds) {
          const owned = await deps.isAgentOwnedBy(id, deps.ownerSub);
          if (!owned) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Agent ${id} does not exist or is not owned by you.`,
            });
          }
        }
      }

      const expiresAt =
        input.expiresAt == null ? null : new Date(input.expiresAt);
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "expiresAt must be in the future.",
        });
      }

      const { token, hash } = deps.mintToken();
      const row = await deps.insert({
        id: generateKeyId(),
        ownerSub: deps.ownerSub,
        name: input.name,
        hash,
        scopes: input.scopes,
        agentIds,
        expiresAt,
      });

      return { key: rowToView(row), plaintext: token };
    },

    async revoke(id: string) {
      const ok = await deps.revoke(id, deps.ownerSub);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
    },
  };
}
