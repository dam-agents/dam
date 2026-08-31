import { TRPCError } from "@trpc/server";
import type {
  Agent,
  AgentsService,
  KbShareCreateInput,
  KbShareDefaults,
  KbShareRefreshInput,
  KbShareResolveInput,
  KbShareResolveResult,
  KbSharesService,
  KbShareSetNameInput,
  KbShareStringResult,
  KbShareView,
  KbShareWorkspaceListing,
} from "api-server-api";
import { isUniqueViolation } from "../../../core/db-errors.js";
import { securityLog } from "../../../core/security-log.js";
import {
  formatShareString,
  kbShareRowId,
  mintShareId,
  mintShareSecret,
  parseShareString,
  secretsEqual,
  shareIdFromRowId,
} from "../domain/share-string.js";
import type { KbShareRow } from "../domain/types.js";

export interface KbSharesServiceDeps {
  owner: string;
  agents: Pick<AgentsService, "get">;
  findActiveByAgent: (agentId: string) => Promise<KbShareRow | null>;
  findActiveById: (rowId: string) => Promise<KbShareRow | null>;
  listActiveByOwner: (owner: string) => Promise<KbShareRow[]>;
  insert: (row: {
    id: string;
    agentId: string;
    owner: string;
    secret: string;
    publicName: string | null;
    roots: readonly string[];
  }) => Promise<KbShareRow>;
  updateSecret: (agentId: string, secret: string) => Promise<boolean>;
  updatePublicName: (agentId: string, name: string) => Promise<boolean>;
  updateRoots: (agentId: string, roots: readonly string[]) => Promise<boolean>;
  revokeByAgent: (agentId: string) => Promise<KbShareRow | null>;
  purgeShareObjects: (row: KbShareRow) => Promise<void>;
  requestFlush: (agentId: string) => Promise<void>;
  unconfigurePod: (agentId: string) => Promise<void>;
  defaultRootsForKbTemplate: (
    kbTemplateId: string | undefined,
  ) => readonly string[];
  listWorkspaceRoots: (agentId: string) => Promise<string[]>;
  objectStoreConfigured: boolean;
  logActor?: "user" | "agent";
}

function rowToView(row: KbShareRow): KbShareView {
  return {
    agentId: row.agentId,
    publicName: row.publicName,
    roots: row.roots,
    publishState: row.publishState,
    publishError: row.publishError,
    snapshotCreatedAt: row.snapshotCreatedAt
      ? row.snapshotCreatedAt.toISOString()
      : null,
    documentCount: row.documentCount,
    totalSizeBytes: row.totalSizeBytes,
    queryCount: row.queryCount,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createKbSharesService(
  deps: KbSharesServiceDeps,
): KbSharesService {
  function logShareAction(event: string, agentId: string): void {
    const asAgent = deps.logActor === "agent";
    securityLog("info", event, {
      category: "resource",
      actor: asAgent ? agentId : deps.owner,
      actorKind: asAgent ? "agent" : "user",
      ...(asAgent ? { surface: "mcp" as const } : {}),
      agentId,
      result: "success",
    });
  }

  async function requireOwnedKnowledgeBase(agentId: string): Promise<Agent> {
    const agent = await deps.agents.get(agentId);
    if (!agent) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "knowledge base not found",
      });
    }
    if (agent.kind !== "knowledge-base") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "sharing is available only for knowledge bases",
      });
    }
    return agent;
  }

  async function requireActiveShare(agentId: string): Promise<KbShareRow> {
    await requireOwnedKnowledgeBase(agentId);
    const row = await deps.findActiveByAgent(agentId);
    if (!row) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "this knowledge base is not shared",
      });
    }
    return row;
  }

  return {
    async status(agentId: string): Promise<KbShareView | null> {
      await requireOwnedKnowledgeBase(agentId);
      const row = await deps.findActiveByAgent(agentId);
      return row ? rowToView(row) : null;
    },

    async list(): Promise<KbShareView[]> {
      const rows = await deps.listActiveByOwner(deps.owner);
      return rows.map(rowToView);
    },

    async defaults(agentId: string): Promise<KbShareDefaults> {
      const agent = await requireOwnedKnowledgeBase(agentId);
      const workspace: KbShareWorkspaceListing = await deps
        .listWorkspaceRoots(agentId)
        .then((roots): KbShareWorkspaceListing => ({ state: "listed", roots }))
        .catch((): KbShareWorkspaceListing => ({ state: "unreachable" }));
      return {
        roots: deps.defaultRootsForKbTemplate(agent.kbTemplateId),
        workspace,
      };
    },

    async create(input: KbShareCreateInput): Promise<KbShareView> {
      const agent = await requireOwnedKnowledgeBase(input.agentId);
      if (!deps.objectStoreConfigured) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "no object store is configured on this deployment; knowledge base sharing is unavailable",
        });
      }
      const existing = await deps.findActiveByAgent(input.agentId);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "this knowledge base is already shared",
        });
      }
      let row: KbShareRow;
      try {
        row = await deps.insert({
          id: kbShareRowId(mintShareId()),
          agentId: input.agentId,
          owner: deps.owner,
          secret: mintShareSecret(),
          publicName: agent.name,
          roots:
            input.roots ?? deps.defaultRootsForKbTemplate(agent.kbTemplateId),
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "this knowledge base is already shared",
          });
        }
        throw err;
      }
      logShareAction("kb_share.created", input.agentId);
      void deps.requestFlush(input.agentId).catch((err: unknown) => {
        process.stderr.write(
          `[kb-shares] publish nudge failed for ${input.agentId}: ${err}\n`,
        );
      });
      return rowToView(row);
    },

    async reveal(agentId: string): Promise<KbShareStringResult> {
      const row = await requireActiveShare(agentId);
      return {
        shareString: formatShareString(shareIdFromRowId(row.id), row.secret),
      };
    },

    async rotate(agentId: string): Promise<KbShareStringResult> {
      const row = await requireActiveShare(agentId);
      const secret = mintShareSecret();
      await deps.updateSecret(agentId, secret);
      logShareAction("kb_share.rotated", agentId);
      return {
        shareString: formatShareString(shareIdFromRowId(row.id), secret),
      };
    },

    async revoke(agentId: string): Promise<void> {
      await requireActiveShare(agentId);
      const revoked = await deps.revokeByAgent(agentId);
      logShareAction("kb_share.revoked", agentId);
      void deps.unconfigurePod(agentId).catch(() => {});
      if (revoked) {
        void deps.purgeShareObjects(revoked).catch((err: unknown) => {
          process.stderr.write(
            `[kb-shares] snapshot purge failed for ${agentId}: ${err}\n`,
          );
        });
      }
    },

    async refresh(input: KbShareRefreshInput): Promise<KbShareView> {
      await requireActiveShare(input.agentId);
      if (input.roots) {
        await deps.updateRoots(input.agentId, input.roots);
      }
      void deps.requestFlush(input.agentId).catch((err: unknown) => {
        process.stderr.write(
          `[kb-shares] publish nudge failed for ${input.agentId}: ${err}\n`,
        );
      });
      const row = await requireActiveShare(input.agentId);
      return rowToView(row);
    },

    async setName(input: KbShareSetNameInput): Promise<KbShareView> {
      await requireActiveShare(input.agentId);
      await deps.updatePublicName(input.agentId, input.name);
      logShareAction("kb_share.renamed", input.agentId);
      const row = await requireActiveShare(input.agentId);
      return rowToView(row);
    },

    async resolveLink(
      input: KbShareResolveInput,
    ): Promise<KbShareResolveResult> {
      const parsed = parseShareString(input.shareString);
      if (!parsed) return { valid: false, name: null };
      const row = await deps.findActiveById(kbShareRowId(parsed.shareId));
      if (!row || !secretsEqual(row.secret, parsed.secret)) {
        return { valid: false, name: null };
      }
      return { valid: true, name: row.publicName };
    },
  };
}
