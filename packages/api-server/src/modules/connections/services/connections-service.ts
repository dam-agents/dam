import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import {
  parseKbShareString,
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  displayNameForTemplate,
  PLATFORM_LLM_TEMPLATE_ID,
  PROVIDER_TEMPLATE_IDS,
  providerTypeForTemplateId,
  type ConnectionStatus,
  SHARED_KB_TEMPLATE_ID,
  IBM_LITELLM_HOST,
  type AgentConnections,
  type Connection,
  type ConnectionCreateInput,
  type ConnectionCredentialUpdate,
  type ConnectionsService,
  type ConnectionTemplateView,
  type ConnectionView,
  type Contribution,
  type CredentialCheck,
  type CredentialCheckPolicy,
  githubHostOf,
  type ProviderBalance,
  type ProviderKeyCheck,
  type ProviderKeyRecheck,
  type SecretRef,
  preferenceGroupOf,
  signingTargetOf,
  unaddressableRivalHost,
  aliasForProviderType,
  orderByAlias,
  providerAliasConflict,
  harnessFits,
  type ConnectionProviderView,
  type HarnessCatalog,
  type ProviderPresetType,
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
  configInputContributions,
  gitHubAppApiBase,
  normalizePrivateKeyPem,
} from "../domain/build-connection.js";
import { parseGitHubAppScope } from "../domain/github-app-scope.js";
import {
  gitHubUserTokenApiBase,
  parseGitHubUserTokenScope,
  supportsGitHubUserTokenScope,
} from "../domain/github-user-token-scope.js";
import {
  shareIdFromTokenHeader,
  tokenHeaderName,
} from "../../kb-shares/index.js";
import {
  tokenRejectionOf,
  withoutRefreshFailureMarker,
} from "../domain/refresh-failure-marker.js";
import {
  buildConnectionSdsFields,
  connectionSecretAnnotations,
  CONNECTION_TOKEN_PLACEHOLDER,
  UPSTREAM_CA_SECRET_FIELD,
} from "../domain/connection-sds.js";
import {
  awsCredentialsFile,
  parseS3Endpoint,
  s3EndpointOrigin,
  type Sigv4KeyPair,
  sigv4KeyPair,
} from "../domain/s3-contributions.js";
import {
  balanceQueryFor,
  type ProviderBalanceSource,
} from "../domain/provider-balance.js";
import type {
  S3CredentialProbe,
  S3CredentialProbeFailure,
} from "../domain/s3-credential-probe.js";
import {
  providerKeyTargetOf,
  type ProviderKeyProbe,
  type ProviderKeyProbeOutcome,
} from "../domain/provider-key-probe.js";
import { discoverMcpAuth } from "../infrastructure/mcp-discovery.js";
import { probeClusterCa } from "../infrastructure/cluster-ca-probe.js";
import type { OAuthEngine } from "../infrastructure/oauth-engine.js";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import type { ContributionFanOut } from "./contribution-fanout.js";
import type { OAuthFlowService } from "./oauth-flow.js";
import { mintClientCredentialsToken } from "./client-credentials.js";
import { gitHubAppMintLockKey, mintGitHubAppToken } from "./github-app.js";
import type { XactLock } from "../../../core/xact-lock.js";
import {
  refreshOAuthAccessToken,
  resolveOAuthClientSecret,
  type OAuthAuth,
} from "./oauth-token.js";
import { scopeGitHubUserToken } from "./github-user-token.js";
import { connectionRefreshLockKey } from "./oauth-refresh.js";
import { recordAccountLabel } from "./account-label.js";
import { accountLabelOf } from "../domain/account-label.js";
import {
  KEY_CHECK_INPUT_KEY,
  keyCheckOf,
} from "../domain/provider-key-check.js";
import {
  CREDENTIAL_CHECK_INPUT_KEY,
  CredentialCheckNotPassed,
  credentialCheckOf,
  fromKeyCheck,
  type CredentialProbe,
} from "../domain/credential-check.js";
import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";
import { isUniqueViolation } from "../../../core/db-errors.js";

const MAX_SHARED_KB_CONNECTIONS_PER_OWNER = 20;
const PROVIDER_IS_ACTIVE: Record<ConnectionStatus, boolean> = {
  active: true,
  expired: false,
  pending: false,
  disconnected: false,
};

function assertNoUnaddressableRival(
  added: readonly Connection[],
  desired: readonly Connection[],
): void {
  for (const connection of added) {
    const conflict = providerAliasConflict(desired, connection);
    if (conflict) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `this agent already has a ${conflict.displayName} provider ('${conflict.held.name}'); an agent holds one '${conflict.alias}' provider, so remove it before granting '${connection.name}'`,
      });
    }
    for (const other of desired) {
      const host = unaddressableRivalHost(connection, other);
      if (host === undefined) continue;
      throw new TRPCError({
        code: "CONFLICT",
        message: `an agent can use only one of '${other.name}' and '${connection.name}': both sign in to ${host}`,
      });
    }
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a provider Connection the deployment owns: the
 * template exists only while the deployment configures it, its key is the
 * deployment's, and the user never enters or changes it.
 */
export interface ManagedProvider {
  templateId: string;
  name: string;
  key: string | null;
  ca: string | null;
  refusal: string;
  enabled: () => Promise<boolean>;
}

export interface ManagedProviderConnections {
  reconcileManagedConnections(): Promise<void>;
}

export function createConnectionsService(deps: {
  ownerId: string;
  templates: ConnectionTemplateRegistry;
  repo: ConnectionsRepository;
  secretStore: SecretStore;
  fanOut: ContributionFanOut;
  oauthFlow: OAuthFlowService;
  oauthEngine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  s3CredentialProbe: S3CredentialProbe;
  providerBalance: ProviderBalanceSource;
  providerKeyProbe: ProviderKeyProbe;
  credentialProbe: CredentialProbe;
  oauthCallbackUrl: string;
  brandName: string;
  connectionLock: XactLock;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  resolveKbShare: (
    shareId: string,
    presentedSecret: string | null,
  ) => Promise<{
    agentId: string;
    name: string | null;
    reachable: boolean;
  } | null>;
  maxSharedKbConnections?: number;
  platformProviderEnabled: () => Promise<boolean>;
  platformProviderKey: string | null;
  platformProviderCa?: string | null;
  curveBenderDeploymentKey?: string | null;
  harnesses: Pick<HarnessCatalog, "default" | "harnesses">;
}): ConnectionsService & ManagedProviderConnections {
  const maxSharedKbConnections =
    deps.maxSharedKbConnections ?? MAX_SHARED_KB_CONNECTIONS_PER_OWNER;

  function providerView(templateId: string): ConnectionProviderView | null {
    const type = providerTypeForTemplateId(templateId);
    if (type === null) return null;
    return {
      alias: aliasForProviderType(type),
      harnesses: deps.harnesses.harnesses
        .filter((h) => harnessFits(deps.harnesses, h.name, type, templateId))
        .map((h) => h.name),
    };
  }

  async function firstProviderPerAlias(
    fits: (type: ProviderPresetType, templateId: string) => boolean,
    harness?: string,
    upTo?: string,
  ): Promise<{ id: string; type: ProviderPresetType }[]> {
    const oldest = await deps.repo.listByOwnerOldestFirst(deps.ownerId);
    const cutoff =
      upTo === undefined ? -1 : oldest.findIndex((c) => c.id === upTo);
    const usable = (
      cutoff === -1 ? oldest : oldest.slice(0, cutoff + 1)
    ).flatMap((c) => {
      const type = providerTypeForTemplateId(c.templateId);
      return type !== null &&
        fits(type, c.templateId) &&
        PROVIDER_IS_ACTIVE[deriveStatus(c)]
        ? [{ id: c.id, type }]
        : [];
    });
    const aliases = new Set<string>();
    return orderByAlias(usable, harness).filter((c) => {
      const alias = aliasForProviderType(c.type);
      if (aliases.has(alias)) return false;
      aliases.add(alias);
      return true;
    });
  }

  async function preferredProviderId(): Promise<string | undefined> {
    const harness = deps.harnesses.default;
    const granted = await firstProviderPerAlias((type, templateId) =>
      harnessFits(deps.harnesses, harness, type, templateId),
    );
    return orderByAlias(granted, harness)[0]?.id;
  }

  function toView(conn: Connection, preferredId?: string): ConnectionView {
    const template = deps.templates.get(conn.templateId);
    const accountLabel = accountLabelOf(conn);
    const keyCheck = keyCheckOf(conn);
    const check = credentialCheckOf(conn);
    const hosts = [
      ...new Set(
        conn.contributions.flatMap((c) =>
          c.kind === "egress-allow" ||
          c.kind === "egress-inject" ||
          c.kind === "egress-sign"
            ? [c.host]
            : [],
        ),
      ),
    ];
    const presetAppSlug =
      conn.auth.kind === "oauth" &&
      template?.authKind === "oauth" &&
      conn.auth.clientId === template.clientId &&
      typeof template.extras?.appSlug === "string"
        ? template.extras.appSlug
        : undefined;
    const appSlug =
      conn.auth.kind === "oauth"
        ? (conn.auth.appSlug ?? presetAppSlug)
        : undefined;
    const oauthExtras =
      conn.auth.kind === "oauth" ||
      conn.auth.kind === "client-credentials" ||
      conn.auth.kind === "github-app"
        ? {
            ...(conn.auth.host ? { host: conn.auth.host } : {}),
            ...(appSlug ? { appSlug } : {}),
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
            ...(conn.auth.kind === "oauth" &&
            supportsGitHubUserTokenScope(conn.templateId)
              ? {
                  githubUserToken: conn.auth.githubUserTokenScope
                    ? { scope: conn.auth.githubUserTokenScope }
                    : {},
                }
              : {}),
          }
        : {};
    const provider = providerView(conn.templateId);
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
      ...(accountLabel ? { accountLabel } : {}),
      ...(keyCheck ? { keyCheck } : {}),
      ...(check ? { check } : {}),
      ...oauthExtras,
      ...(provider
        ? { provider: { ...provider, preferred: conn.id === preferredId } }
        : {}),
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

  async function fanOutToAgents(
    connectionId: string,
    agentIds: readonly string[],
    allOwnerConnectionIds: ReadonlySet<string>,
    failureEvent: string,
  ): Promise<void> {
    for (const agentId of agentIds) {
      try {
        await deps.connectionLock(`agent:connections:${agentId}`, async () => {
          const grantedConnections =
            await deps.repo.listConnectionsForAgent(agentId);
          await deps.fanOut.apply({
            agentId,
            ownerId: deps.ownerId,
            grantedConnections,
            allOwnerConnectionIds,
          });
        });
      } catch (err) {
        securityLog("warn", failureEvent, {
          category: "credential",
          actor: deps.ownerId,
          actorKind: "user",
          agentId,
          target: connectionId,
          result: "failure",
          reason: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  }

  function withConfigInputs(
    conn: Connection,
    configInputs: Record<string, string>,
  ): Contribution[] {
    const template = deps.templates.get(conn.templateId);
    const specs =
      template?.authKind === "header" ? (template.configInputs ?? []) : [];
    if (specs.length === 0 || specs.some((s) => s.inputName === "region")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This connection's settings cannot be changed in place. Reconnect it instead.",
      });
    }
    const envNames = new Set(specs.map((s) => s.envName));
    let pinned: Contribution[];
    try {
      pinned = configInputContributions(specs, configInputs);
    } catch (err) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: err instanceof Error ? err.message : "invalid settings",
      });
    }
    return [
      ...conn.contributions.filter(
        (c) => c.kind !== "env" || !envNames.has(c.name),
      ),
      ...pinned,
    ];
  }

  async function putConnectionSecret(
    connectionId: string,
    templateId: string,
    path: string,
    fields: Record<string, string>,
    contributions: Contribution[],
  ): Promise<void> {
    await deps.secretStore.put(
      { storeId: deps.secretStore.storeId, path, field: "" },
      fields,
      {
        owner: deps.ownerId,
        purpose: `connection:${templateId}`,
        extraLabels: {
          "agent-platform.ai/secret-type": "connection",
          "agent-platform.ai/connection": connectionId,
        },
        extraAnnotations: connectionSecretAnnotations(contributions),
      },
    );
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
    await recordAccountLabel(conn, value, deps);
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
    await deps.connectionLock(connectionRefreshLockKey(conn.id), async () => {
      const fresh = await deps.repo.get(conn.id, deps.ownerId);
      if (!fresh || fresh.auth.kind !== "client-credentials") return;
      await deps.secretStore.putFields(fresh.auth.accessTokenRef, {
        [fresh.auth.clientSecretRef.field]: clientSecret,
        access_token: minted.accessToken,
        ...buildConnectionSdsFields(fresh.contributions, minted.accessToken),
      });
      await deps.repo.updateAuth(conn.id, {
        ...withoutRefreshFailureMarker(fresh.auth),
        expiresAt: minted.expiresAt,
      });
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
    await deps.connectionLock(gitHubAppMintLockKey(conn.id), async () => {
      const fresh = await deps.repo.get(conn.id, deps.ownerId);
      if (!fresh || fresh.auth.kind !== "github-app") return;
      await deps.secretStore.putFields(fresh.auth.accessTokenRef, {
        [fresh.auth.privateKeyRef.field]: rotated.privateKeyPem,
        access_token: rotated.minted.accessToken,
        ...buildConnectionSdsFields(
          fresh.contributions,
          rotated.minted.accessToken,
        ),
      });
      await deps.repo.updateAuth(conn.id, {
        ...withoutRefreshFailureMarker(fresh.auth),
        expiresAt: rotated.minted.expiresAt,
      });
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
      await deps.connectionLock(connectionRefreshLockKey(conn.id), async () => {
        const fresh = await deps.repo.get(conn.id, deps.ownerId);
        if (!fresh || fresh.auth.kind !== "oauth") return;
        const next = await refreshOAuthAccessToken({
          conn: fresh,
          auth: fresh.auth,
          engine: deps.oauthEngine,
          githubAppEngine: deps.githubAppEngine,
          templates: deps.templates,
          secretStore: deps.secretStore,
        });
        await deps.repo.updateAuth(conn.id, {
          ...withoutRefreshFailureMarker(fresh.auth),
          expiresAt: next.expiresAt,
        });
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

  async function requireGitHubUserTokenConnection(id: string): Promise<{
    conn: Connection;
    auth: OAuthAuth;
  }> {
    const conn = await deps.repo.get(id, deps.ownerId);
    if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
    if (
      conn.auth.kind !== "oauth" ||
      !supportsGitHubUserTokenScope(conn.templateId)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This connection is not a GitHub sign-in.",
      });
    }
    return { conn, auth: conn.auth };
  }

  async function readGitHubUserToken(auth: OAuthAuth): Promise<string> {
    const token = await deps.secretStore.getField(auth.accessTokenRef);
    if (!token) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This connection has not signed in to GitHub yet. Authorize it first.",
      });
    }
    return token;
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

  function rememberShareName(conn: Connection, name: string): void {
    void deps.repo
      .mergeInputs(conn.id, { [SHARE_NAME_INPUT_KEY]: name })
      .catch((err: unknown) => {
        process.stderr.write(
          `[connections] could not remember the shared knowledge base name for ${conn.id}: ${err}\n`,
        );
      });
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: re-pointing writes to two stores that cannot
   * share a transaction — the connection row and the credential store — so the
   * lock buys serialization against a concurrent re-point, not atomicity. The
   * header name is written first deliberately: a failure after it leaves the
   * row pointing at the live share with a stale secret, which reads as expired
   * and is cured by pasting the link again, whereas the reverse order would
   * strand the row on a retired share id that no longer resolves to a name.
   * Returns false when the row disappeared under the lock, leaving the caller
   * to create one rather than hand back an id that no longer exists.
   */
  async function repointSharedKb(
    conn: Connection,
    share: { shareId: string; secret: string },
    remembered: Record<string, string>,
  ): Promise<boolean> {
    const headerName = tokenHeaderName(share.shareId);
    const repointed = await deps.connectionLock(
      connectionRefreshLockKey(conn.id),
      async () => {
        const fresh = await deps.repo.get(conn.id, deps.ownerId);
        if (!fresh) return false;
        if (fresh.auth.kind !== "header") {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This knowledge base is already connected through a connection that cannot be re-pointed. Remove it and connect the link again.",
          });
        }
        if (fresh.auth.headerName !== headerName) {
          await deps.repo.updateAuth(fresh.id, { ...fresh.auth, headerName });
        }
        await rotateHeaderValue(fresh, fresh.auth, share.secret);
        await deps.repo.mergeInputs(fresh.id, remembered);
        return true;
      },
    );
    if (!repointed) return false;
    securityLog("info", "connection.update", {
      category: "credential",
      actor: deps.ownerId,
      actorKind: "user",
      target: conn.id,
      result: "success",
      detail: {
        templateId: conn.templateId,
        authKind: "header",
        repointed: true,
      },
    });
    return true;
  }

  async function assertS3KeysAccepted(
    keys: Sigv4KeyPair,
    target: { endpoint: string; region: string; bucket?: string },
    connectionId: string,
  ): Promise<void> {
    const bucket = target.bucket?.trim();
    const outcome = await deps.s3CredentialProbe.probe({
      endpoint: target.endpoint,
      region: target.region,
      ...(bucket ? { bucket } : {}),
      ...keys,
    });
    if (outcome.ok) return;
    securityLog("warn", "connection.s3_probe_failed", {
      category: "credential",
      actor: deps.ownerId,
      actorKind: "user",
      target: connectionId,
      result: "failure",
      reason: outcome.reason,
      detail: { probe: outcome.detail },
    });
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: s3ProbeFailureMessage(outcome.reason, outcome.detail, bucket),
    });
  }

  function recordProviderKeyOutcome(
    outcome: ProviderKeyProbeOutcome,
    templateId: string,
    connectionId: string,
  ): ProviderKeyCheck | null {
    const checkedAt = new Date().toISOString();
    if (outcome.ok) {
      return outcome.unchecked ? null : { result: "ok", checkedAt };
    }
    securityLog("warn", "connection.provider_key_probe_failed", {
      category: "credential",
      actor: deps.ownerId,
      actorKind: "user",
      target: connectionId,
      result: "failure",
      reason: outcome.reason,
      detail: { templateId, probe: outcome.detail },
    });
    return { result: outcome.reason, detail: outcome.detail, checkedAt };
  }

  async function assertProviderKeyAccepted(
    templateId: string,
    key: string,
    connectionId: string,
    contributions: readonly Contribution[],
  ): Promise<ProviderKeyCheck | null> {
    const check = recordProviderKeyOutcome(
      await deps.providerKeyProbe.probe(
        templateId,
        key,
        providerKeyTargetOf(contributions),
      ),
      templateId,
      connectionId,
    );
    if (check?.result !== "refused") return check;
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `The provider refused this key (${check.detail}). Check that it is complete and still valid.` +
        (templateId === "ibm-litellm"
          ? ` There are two ETE LiteLLM instances, and only keys from https://${IBM_LITELLM_HOST}/ui?page=api-keys work with ${deps.brandName}.`
          : ""),
    });
  }

  async function probeStoredProviderKey(
    conn: Connection,
    valueRef: SecretRef,
  ): Promise<ProviderKeyProbeOutcome> {
    let key: string | null;
    try {
      key = await deps.secretStore.getField(valueRef);
    } catch (err) {
      return {
        ok: false,
        reason: "unverified",
        detail: `the stored key could not be read: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!key)
      return { ok: false, reason: "refused", detail: "no key is stored" };
    return deps.providerKeyProbe.probe(
      conn.templateId,
      key,
      providerKeyTargetOf(conn.contributions),
    );
  }

  async function recheckProviderKey(
    conn: Connection,
  ): Promise<ProviderKeyCheck | null> {
    if (conn.auth.kind !== "header") return null;
    const check = recordProviderKeyOutcome(
      await probeStoredProviderKey(conn, conn.auth.valueRef),
      conn.templateId,
      conn.id,
    );
    if (check) {
      await deps.repo.mergeInputs(conn.id, { [KEY_CHECK_INPUT_KEY]: check });
    }
    return check;
  }

  async function checkHeaderCredential(
    templateId: string,
    value: string,
    connectionId: string,
    contributions: readonly Contribution[],
  ): Promise<CredentialCheck | null> {
    const template = deps.templates.get(templateId);
    if (template?.authKind !== "header" || !template.credentialCheck) {
      return null;
    }
    const outcome = await deps.credentialProbe.probe(
      template.credentialCheck,
      githubHostOf(contributions) ?? "github.com",
      value,
    );
    const check: CredentialCheck = {
      ...outcome,
      at: new Date().toISOString(),
    };
    if (check.status !== "passed") {
      securityLog("warn", "connection.credential_check_not_passed", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: connectionId,
        result: "failure",
        reason: check.status,
        detail: { templateId, check: check.reason },
      });
    }
    return check;
  }

  function holdUnlessPassed(
    check: CredentialCheck | null,
    policy: CredentialCheckPolicy | undefined,
  ): void {
    if (policy?.holdUnlessPassed && check && check.status !== "passed") {
      throw new CredentialCheckNotPassed(check);
    }
  }

  async function rotateSigv4Keys(
    conn: Connection,
    auth: Extract<Connection["auth"], { kind: "sigv4" }>,
    rawKeys: Sigv4KeyPair,
  ): Promise<void> {
    const keys = await rejectIfInvalid(async () => sigv4KeyPair(rawKeys));
    const signing = signingTargetOf(conn.contributions);
    if (!signing) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `connection ${conn.id} has no signing target`,
      });
    }
    const bucket = rememberedInput(conn, "bucket");
    await assertS3KeysAccepted(
      keys,
      {
        endpoint: s3EndpointOrigin(signing),
        region: auth.region,
        ...(bucket ? { bucket } : {}),
      },
      conn.id,
    );
    await deps.secretStore.putFields(auth.accessKeyIdRef, {
      [auth.accessKeyIdRef.field]: keys.accessKeyId,
      [auth.secretAccessKeyRef.field]: keys.secretAccessKey,
      [auth.credentialsFileRef.field]: awsCredentialsFile(keys),
    });
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
        message:
          rejection?.userMessage ??
          (rejection
            ? `The provider rejected the credential (${reviveFailureReason(err)}).`
            : err instanceof Error
              ? err.message
              : "The credential was rejected."),
      });
    }
  }

  async function applyGrants(
    agentId: string,
    desiredFrom: (current: string[]) => string[],
  ): Promise<void> {
    if (!(await deps.isOwnedAgent(agentId))) {
      securityLog("warn", "authz.owner_mismatch", {
        category: "authz",
        actor: deps.ownerId,
        actorKind: "user",
        agentId,
        decision: "deny",
        reason: "agent-not-owned",
        detail: { surface: "connection.grants_set" },
      });
      throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
    }
    const owned = await deps.repo.listByOwner(deps.ownerId);
    const ownedById = new Map(owned.map((c) => [c.id, c]));

    await deps.connectionLock(`agent:connections:${agentId}`, async () => {
      const current = await deps.repo.listAgentGrants(agentId);
      const deduped = Array.from(
        new Set(desiredFrom(current.map((c) => c.connectionId))),
      );
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
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "connection not owned by caller",
          });
        }
      }
      const currentIds = new Set(current.map((c) => c.connectionId));
      const desiredIds = new Set(deduped);
      const toGrant = deduped.filter((id) => !currentIds.has(id));
      const toRevoke = current
        .map((c) => c.connectionId)
        .filter((id) => !desiredIds.has(id));

      const grantedConnections = deduped
        .map((id) => ownedById.get(id))
        .filter((c): c is Connection => c !== undefined);
      assertNoUnaddressableRival(
        grantedConnections.filter((c) => !currentIds.has(c.id)),
        grantedConnections,
      );

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

      await deps.fanOut.apply({
        agentId,
        ownerId: deps.ownerId,
        grantedConnections,
        allOwnerConnectionIds: new Set(owned.map((c) => c.id)),
      });
    });
  }

  const service: Omit<ConnectionsService, "listAndReconcileConnections"> = {
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
        const provider = providerView(t.id);
        return {
          ...templateToView(t, deps.oauthCallbackUrl, preset),
          ...(provider ? { provider } : {}),
        };
      });
    },

    async listConnections(): Promise<ConnectionView[]> {
      const conns = await deps.repo.listByOwner(deps.ownerId);
      const preferredId = conns.some((c) =>
        PROVIDER_TEMPLATE_IDS.has(c.templateId),
      )
        ? await preferredProviderId()
        : undefined;
      const views = conns.map((conn) => toView(conn, preferredId));
      await Promise.all(
        views.map(async (view, i) => {
          const conn = conns[i]!;
          if (conn.templateId !== SHARED_KB_TEMPLATE_ID) return;
          if (conn.auth.kind !== "header") return;
          const remembered = rememberedInput(conn, SHARE_NAME_INPUT_KEY);
          if (remembered) view.name = remembered;
          const shareId = shareIdFromTokenHeader(conn.auth.headerName);
          if (!shareId) {
            view.status = "expired";
            return;
          }
          const presented = await deps.secretStore.getField(conn.auth.valueRef);
          const share = await deps.resolveKbShare(shareId, presented);
          if (!share?.reachable) {
            view.status = "expired";
            return;
          }
          if (!share.name) return;
          view.name = share.name;
          if (share.name !== remembered) rememberShareName(conn, share.name);
        }),
      );
      return views;
    },

    async getConnection(id: string): Promise<ConnectionView | null> {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (!conn) return null;
      return PROVIDER_TEMPLATE_IDS.has(conn.templateId)
        ? toView(conn, await preferredProviderId())
        : toView(conn);
    },

    async validateProviderConnection(id: string): Promise<void> {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (!conn) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "model-provider connection not found or not owned by caller",
        });
      }
      if (!PROVIDER_TEMPLATE_IDS.has(conn.templateId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `connection '${conn.name}' is not a model provider`,
        });
      }
      const status = deriveStatus(conn);
      if (!PROVIDER_IS_ACTIVE[status]) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `model provider '${conn.name}' is ${status}; reconnect it before creating an agent`,
        });
      }
    },

    async defaultProviderConnections(fits, harness, upTo) {
      return (await firstProviderPerAlias(fits, harness, upTo)).map(
        (c) => c.id,
      );
    },

    async getProviderBalance(id: string): Promise<ProviderBalance | null> {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (!conn) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "connection not found",
        });
      }
      const query = balanceQueryFor(conn);
      if (!query || conn.auth.kind !== "header") return null;
      try {
        const credential = await deps.secretStore.getField(conn.auth.valueRef);
        if (!credential) throw new Error("the stored credential is missing");
        return await deps.providerBalance.lookup(query, credential);
      } catch (err) {
        securityLog("warn", "connection.balance_lookup", {
          category: "credential",
          actor: deps.ownerId,
          actorKind: "user",
          target: conn.id,
          result: "failure",
          detail: {
            templateId: conn.templateId,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "the provider did not report a balance",
        });
      }
    },

    async recheckProviderKeys(): Promise<ProviderKeyRecheck[]> {
      const providers = (await deps.repo.listByOwner(deps.ownerId)).filter(
        (c) => PROVIDER_TEMPLATE_IDS.has(c.templateId) && !isManaged(c),
      );
      return Promise.all(
        providers.map(async (conn) => ({
          connectionId: conn.id,
          check: await recheckProviderKey(conn),
        })),
      );
    },

    async checkCredential(id: string): Promise<CredentialCheck | null> {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
      if (conn.auth.kind !== "header") return null;
      if (
        PROVIDER_TEMPLATE_IDS.has(conn.templateId) &&
        conn.templateId !== PLATFORM_LLM_TEMPLATE_ID
      ) {
        const keyCheck = await recheckProviderKey(conn);
        return keyCheck ? fromKeyCheck(keyCheck) : null;
      }
      const template = deps.templates.get(conn.templateId);
      if (template?.authKind !== "header" || !template.credentialCheck) {
        return null;
      }
      const value = await deps.secretStore
        .getField(conn.auth.valueRef)
        .catch(() => null);
      const check: CredentialCheck | null = value
        ? await checkHeaderCredential(
            conn.templateId,
            value,
            conn.id,
            conn.contributions,
          )
        : {
            status: "unchecked",
            reason: "the stored credential could not be read",
            at: new Date().toISOString(),
          };
      await deps.repo.mergeInputs(conn.id, {
        [CREDENTIAL_CHECK_INPUT_KEY]: check,
      });
      return check;
    },

    async validateGrantSet(connectionIds: string[]): Promise<void> {
      const wanted = new Set(connectionIds);
      const granted = (await deps.repo.listByOwner(deps.ownerId)).filter((c) =>
        wanted.has(c.id),
      );
      assertNoUnaddressableRival(granted, granted);
    },

    startOAuth(
      connectionId: string,
      opts?: { returnTo?: string; popup?: boolean },
    ): Promise<{ authUrl: string }> {
      return deps.oauthFlow.startOAuth(connectionId, opts);
    },

    async update(
      id: string,
      credential: ConnectionCredentialUpdate,
      policy?: CredentialCheckPolicy,
    ): Promise<void> {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND" });

      const configInputs =
        "configInputs" in credential ? credential.configInputs : null;
      const contributions = configInputs
        ? withConfigInputs(conn, configInputs)
        : null;

      switch (conn.auth.kind) {
        case "header": {
          const value =
            "accessKeyId" in credential
              ? singleValueOf(credential)
              : credential.value;
          if (value) {
            const check = await assertProviderKeyAccepted(
              conn.templateId,
              value,
              conn.id,
              conn.contributions,
            );
            const credentialCheck = await checkHeaderCredential(
              conn.templateId,
              value,
              conn.id,
              conn.contributions,
            );
            holdUnlessPassed(credentialCheck, policy);
            await rotateHeaderValue(conn, conn.auth, value);
            await deps.repo.mergeInputs(conn.id, {
              [KEY_CHECK_INPUT_KEY]: check,
              [CREDENTIAL_CHECK_INPUT_KEY]: credentialCheck,
            });
          }
          if (contributions) {
            await deps.repo.updateContributions(conn.id, contributions);
            await deps.repo.mergeInputs(conn.id, { configInputs });
            const owned = await deps.repo.listByOwner(deps.ownerId);
            await fanOutToAgents(
              conn.id,
              await deps.repo.listAgentsForConnection(conn.id),
              new Set(owned.map((c) => c.id)),
              "connection.update.fanout_failed",
            );
          }
          break;
        }
        case "client-credentials":
          await rotateClientSecret(conn, conn.auth, singleValueOf(credential));
          break;
        case "github-app":
          await rotatePrivateKey(conn, conn.auth, singleValueOf(credential));
          break;
        case "oauth":
          await rotateOAuthClientSecret(
            conn,
            conn.auth,
            singleValueOf(credential),
          );
          break;
        case "sigv4":
          await rotateSigv4Keys(conn, conn.auth, keyPairOf(credential));
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

      const secretPath = connectionSecretPath(conn.auth);
      if (secretPath) await deps.secretStore.delete({ path: secretPath });

      await deps.repo.delete(id, deps.ownerId);

      if (affectedAgents.length > 0) {
        const ownerConnsAfter = await deps.repo.listByOwner(deps.ownerId);
        const allOwnerConnectionIds = new Set([
          ...ownerConnsAfter.map((c) => c.id),
          id,
        ]);
        await fanOutToAgents(
          conn.id,
          affectedAgents,
          allOwnerConnectionIds,
          "connection.delete.fanout_failed",
        );
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
          secretsDeleted: secretPath ? 1 : 0,
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
          preferred: g.preferred,
        })),
      };
    },

    async setAgentConnections(
      agentId: string,
      connectionIds: string[],
    ): Promise<void> {
      await applyGrants(agentId, () => connectionIds);
    },

    async updateAgentConnections(
      agentId: string,
      change: { grant: string[]; revoke: string[] },
    ): Promise<void> {
      const revoked = new Set(change.revoke);
      await applyGrants(agentId, (current) => [
        ...current.filter((id) => !revoked.has(id)),
        ...change.grant,
      ]);
    },

    async setPreferredConnection(
      agentId: string,
      connectionId: string,
    ): Promise<void> {
      const conn = await deps.repo.get(connectionId, deps.ownerId);
      if (!conn) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "connection not found",
        });
      }
      await deps.connectionLock(`agent:connections:${agentId}`, async () => {
        const granted = await deps.repo.listConnectionsForAgent(agentId);
        if (!granted.some((c) => c.id === connectionId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "connection is not granted to this agent",
          });
        }
        const group = preferenceGroupOf(conn.contributions);
        const siblings = granted
          .filter(
            (c) =>
              c.id !== connectionId &&
              group !== undefined &&
              preferenceGroupOf(c.contributions) === group,
          )
          .map((c) => c.id);
        await deps.repo.setPreferred(agentId, connectionId, siblings);
        securityLog("info", "connection.preferred_set", {
          category: "authz-list",
          actor: deps.ownerId,
          actorKind: "user",
          agentId,
          target: connectionId,
          result: "success",
          detail: { group, cleared: siblings },
        });
        const owned = await deps.repo.listByOwner(deps.ownerId);
        await deps.fanOut.apply({
          agentId,
          ownerId: deps.ownerId,
          grantedConnections: granted,
          allOwnerConnectionIds: new Set(owned.map((c) => c.id)),
        });
      });
    },

    async createFromTemplate(input, policy): Promise<string> {
      const template = deps.templates.get(input.templateId);
      if (!template) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `unknown template ${input.templateId}`,
        });
      }
      let sharedKbInputs: Record<string, string> = {};
      let connectionName = input.name;
      if (
        template.id === SHARED_KB_TEMPLATE_ID &&
        input.authKind === "header"
      ) {
        const parsed = parseKbShareString(input.value);
        if (!parsed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "that does not look like a share link — expected a kbshare_… string",
          });
        }
        const share = await deps.resolveKbShare(parsed.shareId, parsed.secret);
        if (!share?.reachable) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "unknown or revoked share link — ask the knowledge base owner for a current one",
          });
        }
        sharedKbInputs = {
          [SHARE_AGENT_INPUT_KEY]: share.agentId,
          ...(share.name ? { [SHARE_NAME_INPUT_KEY]: share.name } : {}),
        };
        connectionName = `kb-${share.agentId}`;
        const sharedKb = (await deps.repo.listByOwner(deps.ownerId)).filter(
          (c) => c.templateId === SHARED_KB_TEMPLATE_ID,
        );
        const existing = sharedKb.find(
          (c) => rememberedInput(c, SHARE_AGENT_INPUT_KEY) === share.agentId,
        );
        if (existing) {
          const repointed = await repointSharedKb(
            existing,
            parsed,
            sharedKbInputs,
          );
          if (repointed) return existing.id;
        }
        if (sharedKb.length >= maxSharedKbConnections) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Maximum ${maxSharedKbConnections} shared knowledge bases per account — remove one first.`,
          });
        }
      }
      const effectiveInput = await applyFamilyCreds(template, input);
      const built = await rejectIfInvalid(() =>
        buildConnection(
          template,
          effectiveInput,
          (purpose) =>
            deps.secretStore.mintRef({ owner: deps.ownerId, purpose }),
          deps.oauthCallbackUrl,
          deps.brandName,
        ),
      );

      const id = input.id ?? `conn-${randomBytes(6).toString("hex")}`;
      const contributions = built.contributions.map((c): Contribution =>
        c.kind === "mcp-entry" ? { ...c, name: connectionName } : c,
      );
      const secretPath = connectionSecretPath(built.auth);

      let auth = built.auth;
      if (auth.kind === "client-credentials" && secretPath) {
        const clientSecret = built.secrets.get(secretPath)?.["client_secret"];
        if (!clientSecret) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `template ${template.id}: missing clientSecret`,
          });
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
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `template ${template.id}: missing privateKey`,
          });
        }
        const appAuth = auth;
        const minted = await rejectIfInvalid(() =>
          mintGitHubAppToken(deps.githubAppEngine, {
            connectionRef: `connection:${id}:${template.id}`,
            auth: appAuth,
            privateKeyPem,
          }),
        );
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

      if (effectiveInput.authKind === "sigv4" && auth.kind === "sigv4") {
        await assertS3KeysAccepted(
          sigv4KeyPair(effectiveInput),
          {
            endpoint: s3EndpointOrigin(
              parseS3Endpoint(effectiveInput.endpoint),
            ),
            region: auth.region,
            ...(effectiveInput.bucket ? { bucket: effectiveInput.bucket } : {}),
          },
          id,
        );
      }

      const headerValue =
        auth.kind === "header" && secretPath
          ? built.secrets.get(secretPath)?.["value"]
          : undefined;
      const keyCheck = headerValue
        ? await assertProviderKeyAccepted(
            template.id,
            headerValue,
            id,
            contributions,
          )
        : null;
      const credentialCheck = headerValue
        ? await checkHeaderCredential(
            template.id,
            headerValue,
            id,
            contributions,
          )
        : null;
      holdUnlessPassed(credentialCheck, policy);

      if (secretPath) {
        const placeholderSds = buildConnectionSdsFields(
          contributions,
          CONNECTION_TOKEN_PLACEHOLDER,
        );
        await putConnectionSecret(
          id,
          template.id,
          secretPath,
          { ...placeholderSds, ...(built.secrets.get(secretPath) ?? {}) },
          contributions,
        );
      }

      const record: Connection = {
        id,
        ownerId: deps.ownerId,
        templateId: template.id,
        name: connectionName,
        inputs: {
          ...stripSecretsFromInputs(input),
          ...sharedKbInputs,
          ...(keyCheck ? { [KEY_CHECK_INPUT_KEY]: keyCheck } : {}),
          ...(credentialCheck
            ? { [CREDENTIAL_CHECK_INPUT_KEY]: credentialCheck }
            : {}),
        },
        auth,
        contributions,
      };
      try {
        await deps.repo.insert(record);
      } catch (err) {
        if (secretPath) {
          await deps.secretStore.delete({ path: secretPath }).catch(() => {});
        }
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              template.id === SHARED_KB_TEMPLATE_ID
                ? "This knowledge base is already connected."
                : `A connection named "${connectionName}" already exists. Names must be unique per user.`,
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
      if (headerValue) {
        await recordAccountLabel(record, headerValue, deps);
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

    async probeGitHubUserTokenForConnection(input) {
      const { conn, auth } = await requireGitHubUserTokenConnection(
        input.connectionId,
      );
      const accessToken = await readGitHubUserToken(auth);
      return rejectIfInvalid(() =>
        deps.githubAppEngine.readUserInstallations({
          id: `connection:${conn.id}:${conn.templateId}`,
          apiBaseUrl: gitHubUserTokenApiBase(auth.host),
          accessToken,
        }),
      );
    },

    async updateGitHubUserTokenScope(input) {
      const { conn } = await requireGitHubUserTokenConnection(input.id);
      let scope: ReturnType<typeof parseGitHubUserTokenScope>;
      try {
        scope = parseGitHubUserTokenScope(input);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Invalid scope.",
        });
      }

      await deps.connectionLock(connectionRefreshLockKey(conn.id), async () => {
        const fresh = await deps.repo.get(conn.id, deps.ownerId);
        if (!fresh || fresh.auth.kind !== "oauth") return;
        const auth = fresh.auth;
        const accessToken = await readGitHubUserToken(auth);
        const scoped = scope
          ? await rejectIfInvalid(async () =>
              scopeGitHubUserToken(deps.githubAppEngine, {
                connectionRef: `connection:${conn.id}:${conn.templateId}`,
                auth,
                scope,
                clientSecret: await resolveOAuthClientSecret({
                  conn: fresh,
                  auth,
                  templates: deps.templates,
                  secretStore: deps.secretStore,
                }),
                accessToken,
              }),
            )
          : undefined;

        await deps.secretStore.putFields(
          auth.accessTokenRef,
          buildConnectionSdsFields(
            fresh.contributions,
            scoped?.accessToken ?? accessToken,
          ),
        );

        const nextAuth: OAuthAuth = { ...withoutRefreshFailureMarker(auth) };
        delete nextAuth.githubUserTokenScope;
        if (scope) {
          nextAuth.githubUserTokenScope = scoped?.accountLogin
            ? { ...scope, targetLogin: scoped.accountLogin }
            : scope;
        }
        if (scoped?.expiresAt !== undefined) {
          nextAuth.expiresAt = scoped.expiresAt;
        }
        await deps.repo.updateAuth(conn.id, nextAuth);
      });

      securityLog("info", "connection.scope_update", {
        category: "credential",
        actor: deps.ownerId,
        actorKind: "user",
        target: conn.id,
        result: "success",
        detail: {
          templateId: conn.templateId,
          narrowed: scope !== undefined,
          repositoryIds: scope?.repositoryIds?.length ?? 0,
          permissions: Object.keys(scope?.permissions ?? {}).length,
        },
      });
    },
  };

  const managedProviders: readonly ManagedProvider[] = [
    {
      templateId: PLATFORM_LLM_TEMPLATE_ID,
      name: deps.brandName,
      key: deps.platformProviderKey,
      ca: deps.platformProviderCa ?? null,
      refusal:
        "The built-in provider is managed by its feature. Turn the feature on or off in Settings instead.",
      enabled: deps.platformProviderEnabled,
    },
    {
      templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
      name: displayNameForTemplate(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)!,
      key: deps.curveBenderDeploymentKey ?? null,
      ca: null,
      refusal:
        "This provider is managed by the deployment, so it can be neither connected nor changed by hand.",
      enabled: async () => true,
    },
  ];

  const isManaged = (c: Connection) =>
    managedProviders.some((p) => p.templateId === c.templateId);

  async function managedState(provider: ManagedProvider) {
    const template = deps.templates.get(provider.templateId);
    const { key, ca } = provider;
    const wanted =
      template !== null && key !== null && (await provider.enabled());
    const owned = await deps.repo.listByOwner(deps.ownerId);
    const held = owned.filter((c) => c.templateId === provider.templateId);
    const [keep] = wanted ? held.filter((c) => c.auth.kind === "header") : [];
    const remove = held.filter((c) => c !== keep);
    const name = managedConnectionName(
      provider.name,
      new Set(
        owned
          .filter((c) => c.templateId !== provider.templateId)
          .map((c) => c.name),
      ),
    );
    const stored =
      keep?.auth.kind === "header"
        ? await deps.secretStore.get(keep.auth.valueRef)
        : null;
    const rotated =
      keep?.auth.kind === "header" &&
      (stored?.[keep.auth.valueRef.field] !== key ||
        (stored?.[UPSTREAM_CA_SECRET_FIELD] ?? null) !== ca);
    const stale =
      keep !== undefined &&
      (keep.name !== name ||
        rotated ||
        !isDeepStrictEqual(keep.contributions, template?.contributions));
    return {
      owned,
      template: wanted ? template : null,
      key,
      ca,
      keep,
      remove,
      name,
      rotated,
      settled: !remove.length && (!wanted || (keep !== undefined && !stale)),
    };
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a deployment-owned provider is one Connection
   * per user: it exists while the deployment configures it (and, for the
   * built-in provider, while the feature flag is on), follows the
   * deployment's current key and name, and is removed otherwise, never
   * through the user's own create or delete. The flag and the key are read
   * rather than taken from the change event, because a user can record a flag
   * that the install's mode overrides. Flag changes, listings and the boot
   * sweep can all reconcile at once, on any replica, so the flag and the
   * user's Connections are read only under one per-owner lock: whichever runs
   * last sees the last flag. Its Secret holds a copy of the deployment's key,
   * and its CA when one is configured, and is rewritten whole when the key,
   * the CA or the endpoint changes, since the endpoint names the hosts the
   * gateway injects on. A keyless one from before the provider was metered has
   * no Secret to rewrite, so it is replaced.
   */
  async function reconcileManagedProvider(
    provider: ManagedProvider,
  ): Promise<void> {
    await deps.connectionLock(
      `${provider.templateId}:${deps.ownerId}`,
      async () => {
        const { owned, template, key, ca, keep, remove, name, rotated } =
          await managedState(provider);
        for (const conn of remove) await service.deleteConnection(conn.id);
        if (!template || key === null) return;
        if (!keep) {
          await service.createFromTemplate({
            templateId: provider.templateId,
            name,
            authKind: "header",
            value: key,
            ...(ca ? { caData: ca } : {}),
          });
          return;
        }
        if (keep.name !== name) await deps.repo.updateName(keep.id, name);
        const moved = !isDeepStrictEqual(
          keep.contributions,
          template.contributions,
        );
        if ((moved || rotated) && keep.auth.kind === "header") {
          await putConnectionSecret(
            keep.id,
            provider.templateId,
            keep.auth.valueRef.path,
            {
              value: key,
              ...(ca ? { [UPSTREAM_CA_SECRET_FIELD]: ca } : {}),
              ...buildConnectionSdsFields(template.contributions, key),
            },
            template.contributions,
          );
          if (moved) {
            await deps.repo.updateContributions(
              keep.id,
              template.contributions,
            );
          }
          await fanOutToAgents(
            keep.id,
            await deps.repo.listAgentsForConnection(keep.id),
            new Set(owned.map((c) => c.id)),
            "connection.update.fanout_failed",
          );
        }
      },
    );
  }

  async function reconcileManagedConnections(): Promise<void> {
    for (const provider of managedProviders)
      await reconcileManagedProvider(provider);
  }

  const refuseUserManaged = (templateId: string) =>
    new TRPCError({
      code: "FORBIDDEN",
      message: managedProviders.find((p) => p.templateId === templateId)!
        .refusal,
    });

  return {
    ...service,
    async listAndReconcileConnections() {
      try {
        for (const provider of managedProviders) {
          if ((await managedState(provider)).settled) continue;
          await reconcileManagedConnections();
          break;
        }
      } catch (err) {
        securityLog("warn", "connection.platform_provider_reconcile_failed", {
          category: "credential",
          actor: deps.ownerId,
          actorKind: "user",
          result: "failure",
          reason: err instanceof Error ? err.message : "unknown",
        });
      }
      return service.listConnections();
    },
    async createFromTemplate(input, policy) {
      if (managedProviders.some((p) => p.templateId === input.templateId)) {
        throw refuseUserManaged(input.templateId);
      }
      return service.createFromTemplate(input, policy);
    },
    async deleteConnection(id) {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (conn && isManaged(conn)) {
        throw refuseUserManaged(conn.templateId);
      }
      return service.deleteConnection(id);
    },
    async update(id, credential, policy) {
      const conn = await deps.repo.get(id, deps.ownerId);
      if (conn && isManaged(conn)) {
        throw refuseUserManaged(conn.templateId);
      }
      return service.update(id, credential, policy);
    },
    reconcileManagedConnections,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Connection names are unique per user, so a user
 * who already named a Connection after a deployment-owned provider would
 * block it forever; it takes the first free name of the provider, then the
 * provider followed by "LLM", then that numbered from 2, so every replica
 * picks the same.
 */
function managedConnectionName(brand: string, taken: Set<string>): string {
  if (!taken.has(brand)) return brand;
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${brand} LLM` : `${brand} LLM ${n}`;
    if (!taken.has(name)) return name;
  }
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: a consumer's connection identifies the knowledge
 * base it reaches, not the share link it was pasted from — unsharing retires a
 * share id and re-sharing mints a fresh one, so keying on the link would leave
 * one dead row per re-share beside the live one. The knowledge base's agent is
 * therefore remembered on the connection and a link for a knowledge base
 * already connected re-points that same row. Its display name is remembered
 * the same way, because the owner's public name is only readable while the
 * share resolves and a row that stopped working must still say which knowledge
 * base it was, and it is refreshed only while the share is reachable, since
 * the public name is readable to the holder of a working secret and to nobody
 * else. Neither is the connection's own name: that is an internal slug the
 * view replaces with the public name whenever one is known and falls back to
 * otherwise. It is derived from the same agent, so it survives a re-share, and
 * being unique per owner it makes one connection per knowledge base a
 * constraint the store enforces rather than a rule the flow must remember. A
 * public name could not do that job: two owners may publish the same one, and
 * every rename would have to rewrite it.
 *
 * The agent is recorded by the same lookup that authorizes the create, so a
 * connection cannot exist without it — there is no later occasion to learn it,
 * because a share that stopped resolving never answers again.
 */
const SHARE_NAME_INPUT_KEY = "sharedKbName";
const SHARE_AGENT_INPUT_KEY = "sharedKbAgentId";

function rememberedInput(conn: Connection, key: string): string | null {
  const value = conn.inputs[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stripSecretsFromInputs(input: {
  authKind: ConnectionCreateInput["authKind"];
  [k: string]: unknown;
}): Record<string, unknown> {
  const SECRET_KEYS = [
    "value",
    "clientSecret",
    "privateKey",
    "accessKeyId",
    "secretAccessKey",
  ];
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
    case "sigv4":
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

function connectionSecretPath(auth: Connection["auth"]): string | null {
  switch (auth.kind) {
    case "oauth":
    case "client-credentials":
    case "github-app":
      return auth.accessTokenRef.path;
    case "header":
      return auth.valueRef.path;
    case "sigv4":
      return auth.accessKeyIdRef.path;
    case "none":
      return null;
  }
}

function singleValueOf(credential: ConnectionCredentialUpdate): string {
  if (!("value" in credential) || !credential.value) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This connection stores a single credential value, not a key pair.",
    });
  }
  return credential.value;
}

function keyPairOf(credential: ConnectionCredentialUpdate): Sigv4KeyPair {
  if (!("accessKeyId" in credential)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "An Object Storage connection takes an access key ID and a secret access key.",
    });
  }
  return credential;
}

function s3ProbeFailureMessage(
  reason: S3CredentialProbeFailure,
  detail: string,
  bucket: string | undefined,
): string {
  switch (reason) {
    case "refused":
      return (
        `The endpoint refused these keys (${detail}). Check the access key ID and secret access key` +
        (bucket
          ? ` and that the key may reach bucket "${bucket}".`
          : ", or name a bucket the key may reach.")
      );
    case "no-such-bucket":
      return bucket
        ? `The endpoint has no bucket named "${bucket}" that these keys can see (${detail}).`
        : `The endpoint answered that nothing is there (${detail}) — check the endpoint URL.`;
    case "unreachable":
      return `Could not reach the endpoint (${detail}). Check the URL, and that the platform can reach it.`;
    case "failed":
      return `The endpoint did not accept the check request (${detail}).`;
  }
}
