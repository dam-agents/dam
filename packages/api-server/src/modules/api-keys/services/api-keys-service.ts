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
import { mintApiKeyToken } from "../domain/token.js";

/** Active-keys cap per owner. Hard upper bound to keep the table bounded
 *  even under a misbehaving / scripted caller; well above any reasonable
 *  human-issued count (typical CI pipelines use 1–3 keys per user). */
const MAX_ACTIVE_KEYS_PER_OWNER = 50;

export interface ApiKeysServiceDeps {
  ownerSub: string;
  /** When the request principal is an API key, every api-keys.* procedure
   *  rejects — API keys cannot manage API keys. Pass the current request's
   *  keyId, or undefined for browser-flow callers. */
  callerKeyId: string | undefined;
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
  /** Verifies each agent ID exists and is owned by the caller — keys
   *  binding to non-existent agents are a silent footgun. */
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
  const requireBrowserFlow = () => {
    if (deps.callerKeyId !== undefined) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "API keys cannot manage API keys. Use the web UI or `dam auth login`.",
      });
    }
  };

  return {
    async list() {
      requireBrowserFlow();
      const rows = await deps.list(deps.ownerSub);
      return rows.map(rowToView);
    },

    async create(input: ApiKeyCreateInput): Promise<ApiKeyCreateResult> {
      requireBrowserFlow();

      // Bounded active-key count per owner. Race window between count
      // and insert is acceptable — the cap is for resource-bound
      // protection, not a strict invariant.
      const existing = await deps.list(deps.ownerSub);
      if (existing.length >= MAX_ACTIVE_KEYS_PER_OWNER) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Maximum ${MAX_ACTIVE_KEYS_PER_OWNER} active API keys per owner. Revoke an unused one first.`,
        });
      }

      // `agents:manage` is wildcard-bound by design (per-agent management
      // downscoping is a future refinement), so reject minting a management
      // key restricted to a specific agent set.
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

      const { token, hash } = mintApiKeyToken();
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
      requireBrowserFlow();
      const ok = await deps.revoke(id, deps.ownerSub);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
    },
  };
}
