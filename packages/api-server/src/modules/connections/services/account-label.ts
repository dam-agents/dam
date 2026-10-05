import {
  and,
  eq,
  inArray,
  sql,
  type Db,
  connections as connectionsTable,
} from "db";
import type { Connection } from "api-server-api";
import type {
  ConnectionTemplate,
  ConnectionTemplateRegistry,
} from "../domain/connection-template.js";
import { ACCOUNT_LABEL_INPUT_KEY } from "../domain/account-label.js";
import {
  lookupGitHubAccount,
  lookupGoogleAccount,
  lookupSlackAccount,
  type AccountLookup,
} from "../infrastructure/account-lookups.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type { SecretStore } from "../../secret-store/index.js";
import { securityLog } from "../../../core/security-log.js";
import { parseConnectionRow } from "./oauth-refresh.js";

export function accountLookupFor(
  template: ConnectionTemplate | null | undefined,
): AccountLookup | undefined {
  if (!template) return undefined;
  if (template.id === "slack") return lookupSlackAccount;
  if (template.id === "github" || template.id === "github-pat") {
    return lookupGitHubAccount;
  }
  if (template.authKind === "oauth" && template.credentialFamily === "google") {
    return lookupGoogleAccount;
  }
  return undefined;
}

export async function recordAccountLabel(
  conn: Connection,
  accessToken: string,
  deps: {
    repo: Pick<ConnectionsRepository, "mergeInputs">;
    templates: ConnectionTemplateRegistry;
  },
): Promise<boolean> {
  const lookup = accountLookupFor(deps.templates.get(conn.templateId));
  if (!lookup) return false;
  try {
    const label = await lookup(accessToken);
    await deps.repo.mergeInputs(conn.id, { [ACCOUNT_LABEL_INPUT_KEY]: label });
    return true;
  } catch (err) {
    await deps.repo
      .mergeInputs(conn.id, { [ACCOUNT_LABEL_INPUT_KEY]: null })
      .catch(() => {});
    securityLog("warn", "connection.account_lookup", {
      category: "credential",
      actor: conn.ownerId,
      actorKind: "user",
      target: conn.id,
      result: "failure",
      detail: {
        templateId: conn.templateId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return false;
  }
}

async function storedAccessToken(
  conn: Connection,
  secretStore: SecretStore,
): Promise<string | null> {
  switch (conn.auth.kind) {
    case "oauth":
      return secretStore.getField(conn.auth.accessTokenRef);
    case "header":
      return secretStore.getField(conn.auth.valueRef);
    case "client-credentials":
    case "github-app":
    case "sigv4":
    case "none":
      return null;
  }
}

export interface AccountLabelBackfill {
  tickOnce(): Promise<{ labelled: number; failed: number }>;
}

export function createAccountLabelBackfill(deps: {
  db: Db;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
}): AccountLabelBackfill {
  const unlabelledWhileTokenHolds = (
    conn: Connection,
    token: string,
  ): Pick<ConnectionsRepository, "mergeInputs"> => ({
    async mergeInputs(id, patch) {
      const current = await storedAccessToken(conn, deps.secretStore).catch(
        () => null,
      );
      if (current !== token) return;
      await deps.db
        .update(connectionsTable)
        .set({
          inputs: sql`${connectionsTable.inputs} || ${JSON.stringify(patch)}::jsonb`,
        })
        .where(
          and(
            eq(connectionsTable.id, id),
            sql`(${connectionsTable.inputs} ->> ${ACCOUNT_LABEL_INPUT_KEY}) IS NULL`,
          ),
        );
    },
  });
  const templateIds = deps.templates
    .list()
    .filter((t) => accountLookupFor(t) !== undefined)
    .map((t) => t.id);
  const attempted = new Set<string>();

  async function unlabelled(): Promise<Connection[]> {
    const rows = await deps.db
      .select()
      .from(connectionsTable)
      .where(
        and(
          inArray(connectionsTable.templateId, templateIds),
          sql`(${connectionsTable.inputs} ->> ${ACCOUNT_LABEL_INPUT_KEY}) IS NULL`,
          sql`(${connectionsTable.auth} -> 'refreshFailedAt') IS NULL`,
        ),
      );
    return rows
      .map((r) => parseConnectionRow(r))
      .filter((c): c is Connection => c !== null && !attempted.has(c.id));
  }

  return {
    async tickOnce() {
      let labelled = 0;
      let failed = 0;
      if (templateIds.length === 0) return { labelled, failed };
      for (const conn of await unlabelled()) {
        const token = await storedAccessToken(conn, deps.secretStore).catch(
          () => null,
        );
        if (!token) continue;
        attempted.add(conn.id);
        if (
          await recordAccountLabel(conn, token, {
            repo: unlabelledWhileTokenHolds(conn, token),
            templates: deps.templates,
          })
        ) {
          labelled++;
        } else {
          failed++;
        }
      }
      return { labelled, failed };
    },
  };
}
