import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  AgentConnections,
  Connection,
  ConnectionCreateInput,
  ConnectionsService,
  ConnectionTemplateView,
  ConnectionView,
  Contribution,
  SecretRef,
} from "api-server-api";
import type { SecretStore } from "../../secret-store/index.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type {
  ConnectionTemplate,
  ConnectionTemplateRegistry,
} from "../domain/connection-template.js";
import {
  inheritsFamily,
  templateToView,
} from "../domain/connection-template.js";
import {
  buildConnection,
  gitHubAppApiBase,
  normalizePrivateKeyPem,
} from "../domain/build-connection.js";
import { parseGitHubAppScope } from "../domain/github-app-scope.js";
import {
  tokenRejectionOf,
  withoutRefreshFailureMarker,
} from "../domain/refresh-failure-marker.js";
import {
  buildConnectionSdsFields,
  connectionSecretAnnotations,
  CONNECTION_TOKEN_PLACEHOLDER,
} from "../domain/connection-sds.js";
import { discoverMcpAuth } from "../infrastructure/mcp-discovery.js";
import { probeClusterCa } from "../infrastructure/cluster-ca-probe.js";
import type { OAuthEngine } from "../infrastructure/oauth-engine.js";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import type { ContributionFanOut } from "./contribution-fanout.js";
import type { OAuthFlowService } from "./oauth-flow.js";
import { mintClientCredentialsToken } from "./client-credentials.js";
import { gitHubAppMintLockKey, mintGitHubAppToken } from "./github-app.js";
import type { XactLock } from "../../../core/xact-lock.js";
import { refreshOAuthAccessToken } from "./oauth-token.js";
import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";
import { isUniqueViolation } from "../../../core/db-errors.js";

export function createConnectionsService(deps: {
  ownerId: string;
  templates: ConnectionTemplateRegistry;
  repo: ConnectionsRepository;
  secretStore: SecretStore;
  fanOut: ContributionFanOut;
  oauthFlow: OAuthFlowService;
  oauthEngine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  oauthCallbackUrl: string;
  brandName: string;
  connectionLock: XactLock;
}): ConnectionsService {
  function toView(conn: Connection): ConnectionView {
    const template = deps.templates.get(conn.templateId);
    const hosts = conn.contributions
      .filter(
        (
          c,
        ): c is Extract<
          Connection["contributions"][number],
          { kind: "egress-allow" | "egress-inject" }
        > => c.kind === "egress-allow" || c.kind === "egress-inject",
      )
      .map((c) => c.host);
    const oauthExtras =
      conn.auth.kind === "oauth" ||
      conn.auth.kind === "client-credentials" ||
      conn.auth.kind === "github-app"
        ? {
            ...(conn.auth.host ? { host: conn.auth.host } : {}),
            ...(conn.auth.kind === "oauth" && conn.auth.appSlug
              ? { appSlug: conn.auth.appSlug }
              : {}),
            ...(conn.auth.kind === "oauth" && conn.auth.clientSecretRef
              ? { hasClientSecret: true }
              : {}),
            ...(conn.auth.connectedAt
              ? {
                  connectedAt: new Date(
                    conn.auth.connectedAt * 1000,
                  ).toISOString(),
                }
              : {}),
            ...(conn.auth.kind === "github-app"
              ? githubAppScopeView(conn.auth)
              : {}),
          }
        : {};
    return {
      id: conn.id,
      ownerId: conn.ownerId,
      templateId: conn.templateId,
      category: template?.category ?? "other",
      name: conn.name,
      status: deriveStatus(conn),
      authKind: conn.auth.kind,
      contributions: conn.contributions,
      hosts,
      ...oauthExtras,
    };
  }

  async function familyClientCreds(): Promise<
    Map<string, { clientId: string; clientSecretRef?: SecretRef }>
  > {
    const out = new Map<
      string,
      { clientId: string; clientSecretRef?: SecretRef }
    >();
    const conns = await deps.repo.listByOwner(deps.ownerId);
    for (const conn of conns) {
      if (conn.auth.kind !== "oauth" || !conn.auth.clientId) continue;
      const t = deps.templates.get(conn.templateId);
      const family = t?.authKind === "oauth" ? t.credentialFamily : undefined;
      if (!family || out.has(family)) continue;
      out.set(family, {
        clientId: conn.auth.clientId,
        ...(conn.auth.clientSecretRef
          ? { clientSecretRef: conn.auth.clientSecretRef }
          : {}),
      });
    }
    return out;
  }

  async function applyFamilyCreds(
    template: ConnectionTemplate,
    input: ConnectionCreateInput,
  ): Promise<ConnectionCreateInput> {
    if (
      input.authKind !== "oauth" ||
      !inheritsFamily(template) ||
      input.clientId
    ) {
      return input;
    }
    const creds = (await familyClientCreds()).get(template.credentialFamily!);
    if (!creds) return input;
    const clientSecret =
      !input.clientSecret && creds.clientSecretRef
        ? await deps.secretStore.getField(creds.clientSecretRef)
        : input.clientSecret;
    return {
      ...input,
      clientId: creds.clientId,
      ...(clientSecret ? { clientSecret } : {}),
    };
  }

  async function rotateHeaderValue(
    conn: Connection,
    auth: Extract<Connection["auth"], { kind: "header" }>,
    value: string,
  ): Promise<void> {
    await deps.secretStore.putFields(auth.valueRef, {
      value,
      ...buildConnectionSdsFields(conn.contributions, value),
    });
  }

  async function rotateClientSecret(
    conn: Connection,
    auth: Extract<Connection["auth"], { kind: "client-credentials" }>,
    clientSecret: string,
  ): Promise<void> {
    const minted = await rejectIfInvalid(() =>
      mintClientCredentialsToken(deps.oauthEngine, {
        connectionRef: `connection:${conn.id}:${conn.templateId}`,
        auth,
        clientSecret,
      }),
    );
    await deps.secretStore.putFields(auth.accessTokenRef, {
      [auth.clientSecretRef.field]: clientSecret,
      access_token: minted.accessToken,
      ...buildConnectionSdsFields(conn.contributions, minted.accessToken),
    });
    await deps.repo.updateAuth(conn.id, {
      ...withoutRefreshFailureMarker(auth),
      expiresAt: minted.expiresAt,
    });
  }

  async function rotatePrivateKey(
    conn: Connection,
    auth: Extract<Connection["auth"], { kind: "github-app" }>,
    rawPrivateKey: string,
  ): Promise<void> {
    const rotated = await rejectIfInvalid(async () => {
      const privateKeyPem = normalizePrivateKeyPem(rawPrivateKey);
      const minted = await mintGitHubAppToken(deps.githubAppEngine, {
        connectionRef: `connection:${conn.id}:${conn.templateId}`,
        auth,
        privateKeyPem,
      });
      return { privateKeyPem, minted };
    });
    await deps.secretStore.putFields(auth.accessTokenRef, {
      [auth.privateKeyRef.field]: rotated.privateKeyPem,
      access_token: rotated.minted.accessToken,
      ...buildConnectionSdsFields(
        conn.contributions,
        rotated.minted.accessToken,
      ),
    });
    await deps.repo.updateAuth(conn.id, {
      ...withoutRefreshFailureMarker(auth),
      expiresAt: rotated.minted.expiresAt,
    });
  }

  async function rotateOAuthClientSecret(
    conn: Connection,
    auth: Extract<Connection["auth"], { kind: "oauth" }>,
    clientSecret: string,
  ): Promise<void> {
    if (!auth.clientSecretRef) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This connection uses the OAuth client secret configured for the whole deployment. Rotate it there; it can't be replaced per connection.",
      });
    }
    await deps.secretStore.putFields(auth.clientSecretRef, {
      [auth.clientSecretRef.field]: clientSecret,
    });

    try {
      const next = await refreshOAuthAccessToken({
        conn,
        auth,
        engine: deps.oauthEngine,
        templates: deps.templates,
        secretStore: deps.secretStore,
      });
      await deps.repo.updateAuth(conn.id, {
        ...withoutRefreshFailureMarker(auth),
        expiresAt: next.expiresAt,
      });
    } catch (err) {
      securityLog("warn", "connection.client_secret_revive_failed", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: conn.id,
        result: "failure",
        reason: reviveFailureReason(err),
        detail: { templateId: conn.templateId, authKind: conn.auth.kind },
      });
    }
  }

  async function requireGitHubAppConnection(id: string): Promise<{
    conn: Connection;
    auth: Extract<Connection["auth"], { kind: "github-app" }>;
  }> {
    const conn = await deps.repo.get(id, deps.ownerId);
    if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
    if (conn.auth.kind !== "github-app") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This connection is not a GitHub App installation.",
      });
    }
    return { conn, auth: conn.auth };
  }

  async function readPrivateKey(
    auth: Extract<Connection["auth"], { kind: "github-app" }>,
  ): Promise<string> {
    const pem = await deps.secretStore.getField(auth.privateKeyRef);
    if (!pem) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This connection's private key is missing.",
      });
    }
    return pem;
  }

  async function rejectIfInvalid<T>(mint: () => Promise<T>): Promise<T> {
    try {
      return await mint();
    } catch (err) {
      const rejection = tokenRejectionOf(err);
      if (rejection) {
        process.stderr.write(
          `[connections] credential rejected: ${(err as Error).message}\n`,
        );
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: rejection
          ? `The provider rejected the credential (${reviveFailureReason(err)}).`
          : err instanceof Error
            ? err.message
            : "The credential was rejected.",
      });
    }
  }

  return {
    async listTemplates(): Promise<ConnectionTemplateView[]> {
      const templates = deps.templates.list();
      const family = templates.some(inheritsFamily)
        ? await familyClientCreds()
        : null;
      return templates.map((t) => {
        const creds =
          family && inheritsFamily(t) ? family.get(t.credentialFamily!) : null;
        const preset = creds
          ? { clientId: creds.clientId, hasSecret: !!creds.clientSecretRef }
          : undefined;
        return templateToView(t, deps.oauthCallbackUrl, preset);
      });
    },

    async listConnections(): Promise<ConnectionView[]> {
      const conns = await deps.repo.listByOwner(deps.ownerId);
      return conns.map(toView);
    },

    async getConnection(id: string): Promise<ConnectionView | null> {
      const conn = await deps.repo.get(id, deps.ownerId);
      return conn ? toView(conn) : null;
    },

    startOAuth(
      connectionId: string,
      opts?: { returnTo?: string; popup?: boolean },
    ): Promise<{ authUrl: string }> {
      return deps.oauthFlow.startOAuth(connectionId, opts);
    },

    async update(id: string, value: string): Promise<void> {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND" });

      switch (conn.auth.kind) {
        case "header":
          await rotateHeaderValue(conn, conn.auth, value);
          break;
        case "client-credentials":
          await rotateClientSecret(conn, conn.auth, value);
          break;
        case "github-app":
          await rotatePrivateKey(conn, conn.auth, value);
          break;
        case "oauth":
          await rotateOAuthClientSecret(conn, conn.auth, value);
          break;
        case "none":
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This connection stores no credential to update.",
          });
      }

      securityLog("info", "connection.update", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: conn.id,
        result: "success",
        detail: { templateId: conn.templateId, authKind: conn.auth.kind },
      });
    },

    async deleteConnection(id: string): Promise<void> {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (!conn) return;

      const affectedAgents = await deps.repo.listAgentsForConnection(id);

      const paths = new Set<string>();
      switch (conn.auth.kind) {
        case "oauth":
          paths.add(conn.auth.accessTokenRef.path);
          if (conn.auth.refreshTokenRef) {
            paths.add(conn.auth.refreshTokenRef.path);
          }
          break;
        case "client-credentials":
          paths.add(conn.auth.accessTokenRef.path);
          paths.add(conn.auth.clientSecretRef.path);
          break;
        case "github-app":
          paths.add(conn.auth.accessTokenRef.path);
          paths.add(conn.auth.privateKeyRef.path);
          break;
        case "header":
          paths.add(conn.auth.valueRef.path);
          break;
        case "none":
          break;
      }
      for (const path of paths) {
        await deps.secretStore.delete({ path });
      }

      await deps.repo.delete(id, deps.ownerId);

      if (affectedAgents.length > 0) {
        const ownerConnsAfter = await deps.repo.listByOwner(deps.ownerId);
        const allOwnerConnectionIds = new Set([
          ...ownerConnsAfter.map((c) => c.id),
          id,
        ]);
        for (const agentId of affectedAgents) {
          try {
            const grantedConnections =
              await deps.repo.listConnectionsForAgent(agentId);
            await deps.fanOut.apply({
              agentId,
              ownerId: deps.ownerId,
              grantedConnections,
              allOwnerConnectionIds,
            });
          } catch (err) {
            securityLog("warn", "connection.delete.fanout_failed", {
              category: "credential",
              actor: deps.ownerId,
              actorKind: "user",
              agentId,
              target: conn.id,
              result: "failure",
              reason: err instanceof Error ? err.message : "unknown",
            });
          }
        }
      }

      const template = deps.templates.get(conn.templateId);
      securityLog("info", "connection.delete", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: conn.id,
        result: "success",
        detail: {
          templateId: conn.templateId,
          authKind: conn.auth.kind,
          secretsDeleted: paths.size,
          affectedAgents: affectedAgents.length,
        },
      });
      if (deriveStatus(conn) !== "pending") {
        emit({
          type: EventType.ConnectionRemoved,
          actorSub: deps.ownerId,
          connectionKey: conn.id,
          templateId: conn.templateId,
          kind: template?.category === "mcp" ? "mcp" : "oauth_app",
        });
      }
    },

    async getAgentConnections(agentId: string): Promise<AgentConnections> {
      const grants = await deps.repo.listAgentGrants(agentId);
      return {
        agentId,
        connections: grants.map((g) => ({
          connectionId: g.connectionId,
          grantedAt: g.grantedAt.toISOString(),
        })),
      };
    },

    async setAgentConnections(
      agentId: string,
      connectionIds: string[],
    ): Promise<void> {
      const deduped = Array.from(new Set(connectionIds));

      const owned = await deps.repo.listByOwner(deps.ownerId);
      const ownedById = new Map(owned.map((c) => [c.id, c]));
      for (const id of deduped) {
        if (!ownedById.has(id)) {
          securityLog("warn", "authz.owner_mismatch", {
            category: "authz",
            actor: deps.ownerId,
            actorKind: "user",
            agentId,
            decision: "deny",
            reason: "connection-not-owned",
            target: id,
            detail: { surface: "connection.grants_set" },
          });
          throw new Error(`connection ${id} not owned by caller`);
        }
      }

      const current = await deps.repo.listAgentGrants(agentId);
      const currentIds = new Set(current.map((c) => c.connectionId));
      const desiredIds = new Set(deduped);

      const toGrant = deduped.filter((id) => !currentIds.has(id));
      const toRevoke = current
        .map((c) => c.connectionId)
        .filter((id) => !desiredIds.has(id));

      for (const id of toGrant) await deps.repo.grant(id, agentId);
      for (const id of toRevoke) await deps.repo.revoke(id, agentId);

      if (toGrant.length > 0 || toRevoke.length > 0) {
        securityLog("info", "connection.grants_set", {
          category: "authz-list",
          actor: deps.ownerId,
          actorKind: "user",
          agentId,
          result: "success",
          detail: { granted: toGrant, revoked: toRevoke },
        });
      }

      const grantedConnections = deduped
        .map((id) => ownedById.get(id))
        .filter((c): c is Connection => c !== undefined);
      await deps.fanOut.apply({
        agentId,
        ownerId: deps.ownerId,
        grantedConnections,
        allOwnerConnectionIds: new Set(owned.map((c) => c.id)),
      });
    },

    async createFromTemplate(input): Promise<string> {
      const template = deps.templates.get(input.templateId);
      if (!template) {
        throw new Error(`unknown template ${input.templateId}`);
      }
      const effectiveInput = await applyFamilyCreds(template, input);
      const built = await buildConnection(
        template,
        effectiveInput,
        (purpose) => deps.secretStore.mintRef({ owner: deps.ownerId, purpose }),
        deps.oauthCallbackUrl,
        deps.brandName,
      );

      const id = input.id ?? newConnectionId();
      const contributions = built.contributions.map(
        (c): Contribution =>
          c.kind === "mcp-entry" ? { ...c, name: input.name } : c,
      );
      const secretPath = connectionSecretPath(built.auth);

      let auth = built.auth;
      if (auth.kind === "client-credentials" && secretPath) {
        const clientSecret = built.secrets.get(secretPath)?.["client_secret"];
        if (!clientSecret) {
          throw new Error(`template ${template.id}: missing clientSecret`);
        }
        const minted = await mintClientCredentialsToken(deps.oauthEngine, {
          connectionRef: `connection:${id}:${template.id}`,
          auth,
          clientSecret,
        });
        auth = {
          ...auth,
          connectedAt: Math.floor(Date.now() / 1000),
          expiresAt: minted.expiresAt,
        };
        built.secrets.set(secretPath, {
          ...(built.secrets.get(secretPath) ?? {}),
          access_token: minted.accessToken,
          ...buildConnectionSdsFields(contributions, minted.accessToken),
        });
        securityLog("info", "oauth.token_mint", {
          category: "credential",
          actor: deps.ownerId,
          actorKind: "user",
          target: id,
          result: "success",
          detail: { templateId: template.id, grant: "client_credentials" },
        });
      }

      if (auth.kind === "github-app" && secretPath) {
        const privateKeyPem = built.secrets.get(secretPath)?.["private_key"];
        if (!privateKeyPem) {
          throw new Error(`template ${template.id}: missing privateKey`);
        }
        const minted = await mintGitHubAppToken(deps.githubAppEngine, {
          connectionRef: `connection:${id}:${template.id}`,
          auth,
          privateKeyPem,
        });
        auth = {
          ...auth,
          connectedAt: Math.floor(Date.now() / 1000),
          expiresAt: minted.expiresAt,
        };
        built.secrets.set(secretPath, {
          ...(built.secrets.get(secretPath) ?? {}),
          access_token: minted.accessToken,
          ...buildConnectionSdsFields(contributions, minted.accessToken),
        });
        securityLog("info", "oauth.token_mint", {
          category: "credential",
          actor: deps.ownerId,
          actorKind: "user",
          target: id,
          result: "success",
          detail: {
            templateId: template.id,
            grant: "github_app_installation",
          },
        });
      }

      if (secretPath) {
        const placeholderSds = buildConnectionSdsFields(
          contributions,
          CONNECTION_TOKEN_PLACEHOLDER,
        );
        await deps.secretStore.put(
          { storeId: deps.secretStore.storeId, path: secretPath, field: "" },
          { ...placeholderSds, ...(built.secrets.get(secretPath) ?? {}) },
          {
            owner: deps.ownerId,
            purpose: `connection:${template.id}`,
            extraLabels: {
              "agent-platform.ai/secret-type": "connection",
              "agent-platform.ai/connection": id,
            },
            extraAnnotations: connectionSecretAnnotations(contributions),
          },
        );
      }

      try {
        await deps.repo.insert({
          id,
          ownerId: deps.ownerId,
          templateId: template.id,
          name: input.name,
          inputs: stripSecretsFromInputs(input),
          auth,
          contributions,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A connection named "${input.name}" already exists. Names must be unique per user.`,
          });
        }
        throw err;
      }
      securityLog("info", "connection.create", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: id,
        result: "success",
        detail: { templateId: template.id, authKind: built.auth.kind },
      });
      if (built.auth.kind !== "oauth") {
        emit({
          type: EventType.ConnectionCreated,
          actorSub: deps.ownerId,
          connectionKey: id,
          templateId: template.id,
          kind: template.category === "mcp" ? "mcp" : "oauth_app",
        });
      }
      return id;
    },

    async discoverMcp(input): Promise<{ auth: "oauth" | "none" }> {
      try {
        const meta = await discoverMcpAuth(new URL(input.url));
        return {
          auth: meta && meta.registrationEndpoint ? "oauth" : "none",
        };
      } catch {
        return { auth: "none" };
      }
    },

    probeClusterCa(input) {
      return probeClusterCa(input.host);
    },

    async probeGitHubAppInstallation(input) {
      const template = deps.templates.get(input.templateId);
      if (!template || template.authKind !== "github-app") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This template does not use a GitHub App installation.",
        });
      }
      return rejectIfInvalid(async () => {
        const { apiBaseUrl } = gitHubAppApiBase(template, input.host);
        const privateKeyPem = normalizePrivateKeyPem(input.privateKey);
        return deps.githubAppEngine.readInstallation({
          id: `template:${template.id}`,
          appId: input.appId,
          installationId: input.installationId,
          privateKeyPem,
          apiBaseUrl,
        });
      });
    },

    async probeGitHubAppInstallationForConnection(input) {
      const { conn, auth } = await requireGitHubAppConnection(
        input.connectionId,
      );
      const privateKeyPem = await readPrivateKey(auth);
      return rejectIfInvalid(() =>
        deps.githubAppEngine.readInstallation({
          id: `connection:${conn.id}:${conn.templateId}`,
          appId: auth.appId,
          installationId: auth.installationId,
          privateKeyPem,
          apiBaseUrl: auth.apiBaseUrl,
        }),
      );
    },

    async updateGitHubAppScope(input) {
      const { conn, auth } = await requireGitHubAppConnection(input.id);
      const privateKeyPem = await readPrivateKey(auth);

      const scope = parseGitHubAppScope(input);
      const nextAuth: Connection["auth"] = {
        kind: "github-app",
        appId: auth.appId,
        installationId: auth.installationId,
        privateKeyRef: auth.privateKeyRef,
        accessTokenRef: auth.accessTokenRef,
        apiBaseUrl: auth.apiBaseUrl,
        ...(auth.connectedAt ? { connectedAt: auth.connectedAt } : {}),
        ...(auth.host ? { host: auth.host } : {}),
        ...(scope.repositories ? { repositories: scope.repositories } : {}),
        ...(scope.repositoryIds ? { repositoryIds: scope.repositoryIds } : {}),
        ...(scope.permissions ? { permissions: scope.permissions } : {}),
      };

      await deps.connectionLock(gitHubAppMintLockKey(conn.id), async () => {
        const token = await rejectIfInvalid(() =>
          mintGitHubAppToken(deps.githubAppEngine, {
            connectionRef: `connection:${conn.id}:${conn.templateId}`,
            auth: nextAuth as Extract<
              Connection["auth"],
              { kind: "github-app" }
            >,
            privateKeyPem,
          }),
        );

        await deps.secretStore.putFields(auth.accessTokenRef, {
          access_token: token.accessToken,
          ...buildConnectionSdsFields(conn.contributions, token.accessToken),
        });
        await deps.repo.updateAuth(conn.id, {
          ...nextAuth,
          expiresAt: token.expiresAt,
        });
        return token;
      });

      securityLog("info", "connection.scope_update", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: conn.id,
        result: "success",
        detail: {
          templateId: conn.templateId,
          repositories: scope.repositories?.length ?? 0,
          repositoryIds: scope.repositoryIds?.length ?? 0,
          permissions: Object.keys(scope.permissions ?? {}).length,
        },
      });
    },
  };
}

function githubAppScopeView(
  auth: Extract<Connection["auth"], { kind: "github-app" }>,
): { githubAppScope?: NonNullable<ConnectionView["githubAppScope"]> } {
  const scope = {
    ...(auth.repositories ? { repositories: auth.repositories } : {}),
    ...(auth.repositoryIds ? { repositoryIds: auth.repositoryIds } : {}),
    ...(auth.permissions ? { permissions: auth.permissions } : {}),
  };
  return Object.keys(scope).length > 0 ? { githubAppScope: scope } : {};
}

function reviveFailureReason(err: unknown): string {
  const rejection = tokenRejectionOf(err);
  if (rejection) {
    return (
      rejection.oauthError ??
      `token endpoint status ${rejection.status ?? "unknown"}`
    );
  }
  return err instanceof Error ? err.name : "unknown";
}

function stripSecretsFromInputs(input: {
  authKind: ConnectionCreateInput["authKind"];
  [k: string]: unknown;
}): Record<string, unknown> {
  const SECRET_KEYS = ["value", "clientSecret", "privateKey"];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function deriveStatus(conn: Connection): ConnectionView["status"] {
  switch (conn.auth.kind) {
    case "oauth":
      if (!conn.auth.connectedAt && !conn.auth.expiresAt) return "pending";
      return isExpiredAuth(conn.auth) ? "expired" : "active";
    case "client-credentials":
      return isExpiredAuth(conn.auth) ? "expired" : "active";
    case "github-app":
      return isExpiredAuth(conn.auth) ? "expired" : "active";
    case "header":
      return "active";
    case "none":
      return "active";
  }
}

function isExpiredAuth(auth: {
  expiresAt?: number;
  refreshFailedAt?: number;
}): boolean {
  if (auth.refreshFailedAt !== undefined) return true;
  return (
    auth.expiresAt !== undefined &&
    auth.expiresAt < Math.floor(Date.now() / 1000)
  );
}

function newConnectionId(): string {
  return `conn-${randomBytes(6).toString("hex")}`;
}

function connectionSecretPath(auth: Connection["auth"]): string | null {
  switch (auth.kind) {
    case "oauth":
    case "client-credentials":
    case "github-app":
      return auth.accessTokenRef.path;
    case "header":
      return auth.valueRef.path;
    case "none":
      return null;
  }
}
