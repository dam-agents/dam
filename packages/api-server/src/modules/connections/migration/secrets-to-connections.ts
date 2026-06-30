/**
 * Boot migration: drain every legacy provider/PAT K8s Secret into an
 * equivalent Connection, flipping each granting agent's grants, with no
 * disruption and no plaintext exposure. Self-contained — imports nothing from
 * `modules/secrets` (slice 04 deletes it). Removed by the #1273 follow-up once
 * a clean drain is field-confirmed.
 *
 * Per pass, per owner: read + group legacy secrets into logical credentials,
 * map each to a template + recover its bare value, create the Connection
 * idempotently (deterministic id derived from the legacy secret id), flip each
 * granting agent to the connection (union grant) and drop the legacy secret id
 * from the CR, then delete the legacy secret once no agent grants it.
 *
 * Non-blocking and self-disarming: a transient failure leaves the legacy secret
 * intact and re-arms a retry; a permanent skip (malformed / unrecoverable /
 * orphan half) is logged and left alone. A pass with nothing to migrate is a
 * no-op.
 */
import { createHash } from "node:crypto";
import type {
  Connection,
  ConnectionsService,
  Contribution,
  EnvMapping,
} from "api-server-api";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type { SecretStore } from "../../secret-store/index.js";
import type { ConnectionRulesSync } from "../../egress-rules/services/connection-rules-sync.js";
import { createAgentGrantsPort } from "../../agents/infrastructure/agent-grants-port.js";
import {
  buildConnectionSdsFields,
  connectionSecretAnnotations,
} from "../domain/connection-sds.js";
import {
  legacySecretName,
  listLegacySecrets,
  type LegacySecret,
} from "./legacy-secret-reader.js";

const GITHUB_PAT_TEMPLATE_ID = "github-pat";
const CUSTOM_HEADER_TEMPLATE_ID = "custom-header";

export interface MigrateDeps {
  k8sClient: K8sClient;
  repo: ConnectionsRepository;
  secretStore: SecretStore;
  /** Per-owner connections service — used for `createFromTemplate` (PAT) and
   *  the `setAgentConnections` grant flip (owner == agent owner == connection
   *  owner). */
  connectionsServiceFor: (ownerId: string) => ConnectionsService;
  /** Reconciles legacy `egress_rules` rows; called with `grants={}` to revoke a
   *  migrated secret's rows after the connection's rows are in place. Shared. */
  connectionRulesSync: ConnectionRulesSync;
  log: (msg: string) => void;
  dryRun?: boolean;
}

export interface MigrateResult {
  migrated: number;
  skipped: number;
  /** Transient errors (K8s/DB) — the caller re-arms a retry while this is > 0. */
  failed: number;
  report: string[];
}

/** A unit of migration: one Connection's worth of credential, possibly spanning
 *  two legacy secrets (a Bob header+query pair, or a PAT api+git pair). */
interface LogicalCredential {
  owner: string;
  kind: "github-pat" | "provider" | "generic";
  templateId: string;
  primary: LegacySecret;
  twins: LegacySecret[];
  /** primary + twins; the grant flip and deletion act on all of these. */
  secretIds: string[];
}

export async function migrateSecretsToConnections(
  deps: MigrateDeps,
): Promise<MigrateResult> {
  const report: string[] = [];
  let secrets: LegacySecret[];
  try {
    secrets = await listLegacySecrets(deps.k8sClient);
  } catch (e) {
    deps.log(`secrets→connections: list failed, will retry: ${errMsg(e)}`);
    return { migrated: 0, skipped: 0, failed: 1, report };
  }
  if (secrets.length === 0)
    return { migrated: 0, skipped: 0, failed: 0, report };

  const byOwner = new Map<string, LegacySecret[]>();
  for (const s of secrets) {
    const list = byOwner.get(s.owner) ?? [];
    list.push(s);
    byOwner.set(s.owner, list);
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const [owner, ownerSecrets] of byOwner) {
    const { credentials, skips } = groupLogicalCredentials(owner, ownerSecrets);
    for (const skip of skips) {
      skipped++;
      report.push(`SKIP [${owner}] ${skip}`);
      deps.log(`secrets→connections: skip ${skip}`);
    }
    for (const cred of credentials) {
      try {
        const outcome = await migrateCredential(deps, cred, report);
        if (outcome === "migrated") migrated++;
        else if (outcome === "skipped") skipped++;
      } catch (e) {
        failed++;
        deps.log(
          `secrets→connections: credential ${cred.primary.id} failed, will retry: ${errMsg(e)}`,
        );
      }
    }
  }

  deps.log(
    `secrets→connections: migrated ${migrated}, skipped ${skipped}, failed ${failed}${deps.dryRun ? " (dry-run)" : ""}`,
  );
  return { migrated, skipped, failed, report };
}

async function migrateCredential(
  deps: MigrateDeps,
  cred: LogicalCredential,
  report: string[],
): Promise<"migrated" | "skipped"> {
  const value = recoverValue(cred.primary);
  if (value === null) {
    report.push(
      `SKIP [${cred.owner}] ${cred.primary.id} (${cred.primary.type}): value unrecoverable`,
    );
    deps.log(
      `secrets→connections: skip ${cred.primary.id} — value unrecoverable`,
    );
    return "skipped";
  }

  const connId = deterministicId("conn-", cred.primary.id);
  const existing = await deps.repo.get(connId, cred.owner);
  const granting = await findGrantingAgents(deps, cred);

  if (deps.dryRun) {
    report.push(
      `[${cred.owner}] ${cred.primary.displayName} (${cred.kind}/${cred.primary.type}) → ${connId} ` +
        `template=${cred.templateId} env=[${cred.primary.envMappings.map((m) => m.envName).join(",")}] ` +
        `agents=${granting.length}${existing ? " (already migrated)" : ""}`,
    );
    return existing ? "skipped" : "migrated";
  }

  // Only construct the per-owner service for live mutation — the dry-run
  // entrypoint deliberately makes this throw.
  const svc = deps.connectionsServiceFor(cred.owner);

  if (!existing) {
    const name = await freeName(
      deps.repo,
      cred.owner,
      cred.primary.displayName,
    );
    if (cred.kind === "github-pat") {
      // The github-pat template re-bakes all three hosts from the bare PAT.
      await svc.createFromTemplate({
        templateId: GITHUB_PAT_TEMPLATE_ID,
        name,
        authKind: "header",
        value,
        id: connId,
      });
    } else {
      await createExplicitConnection(deps, cred, connId, name, value);
    }
    report.push(`[${cred.owner}] migrated ${cred.primary.id} → ${connId}`);
  }

  for (const agentId of granting) {
    await flipAgent(deps, svc, agentId, cred, connId);
  }

  await deleteLegacySecrets(deps, cred);
  return existing ? "skipped" : "migrated";
}

/** Build the Connection record explicitly from the legacy secret's *actual*
 *  fields — env verbatim from its env-mappings, one egress-inject per legacy
 *  injection — so overridden ibm/bob pins and multi-env generics survive
 *  (template defaults would drop them). */
async function createExplicitConnection(
  deps: MigrateDeps,
  cred: LogicalCredential,
  connId: string,
  name: string,
  value: string,
): Promise<void> {
  const contributions = buildContributions(cred);
  const secretPath = deterministicId(
    "platform-secret-conn-mig-",
    cred.primary.id,
  );
  const ref = {
    storeId: deps.secretStore.storeId,
    path: secretPath,
    field: "",
  };

  // K8s secret before the row, as the create path does; the deterministic path
  // makes a re-run's write an overwrite.
  await deps.secretStore.put(
    ref,
    { value, ...buildConnectionSdsFields(contributions, value) },
    {
      owner: cred.owner,
      purpose: `connection:${cred.templateId}`,
      extraLabels: {
        "agent-platform.ai/secret-type": "connection",
        "agent-platform.ai/connection": connId,
      },
      extraAnnotations: connectionSecretAnnotations(contributions),
    },
  );

  const primary = cred.primary;
  await deps.repo.insert({
    id: connId,
    ownerId: cred.owner,
    templateId: cred.templateId,
    name,
    inputs: {},
    auth: {
      kind: "header",
      valueRef: { ...ref, field: "value" },
      headerName: primary.headerName ?? "Authorization",
      valueFormat: primary.valueFormat ?? "{value}",
    },
    contributions,
  });
}

function buildContributions(cred: LogicalCredential): Contribution[] {
  const env: Contribution[] = cred.primary.envMappings.map((m) => ({
    kind: "env",
    name: m.envName,
    placeholder: m.placeholder,
  }));
  const injections = [cred.primary, ...cred.twins].map(toEgressInject);
  return [...env, ...injections];
}

function toEgressInject(s: LegacySecret): Contribution {
  return {
    kind: "egress-inject",
    host: s.hostPattern,
    headerName: s.headerName ?? "Authorization",
    // Query-param halves store no value-format; the gateway bakes the bare value.
    valueFormat: s.valueFormat ?? "{value}",
    ...(s.pathPattern ? { pathPattern: s.pathPattern } : {}),
    ...(s.queryParamName ? { queryParamName: s.queryParamName } : {}),
  };
}

/** Add the connection to the agent (union with its current grants), hand the
 *  legacy secret's egress rows to the connection, then drop the legacy secret
 *  id(s) from the CR. The grant lands first so the host is never uncovered;
 *  the controller dedupes the brief duplicate (host, header) injection. The
 *  egress rows are *relabeled* in place rather than revoked-and-reinserted:
 *  the legacy row holds the active-row unique slot, so `setAgentConnections`
 *  can't insert the connection's row for an overlapping host — relabeling
 *  avoids both the duplicate and the coverage gap a revoke would open. */
async function flipAgent(
  deps: MigrateDeps,
  svc: ConnectionsService,
  agentId: string,
  cred: LogicalCredential,
  connId: string,
): Promise<void> {
  const grantsPort = createAgentGrantsPort(deps.k8sClient, cred.owner);

  // Build the union from the DB grants (what setAgentConnections reconciles
  // against), not the CR. If the CR's grantedConnectionIds has drifted from the
  // DB, unioning off the CR would make the reconcile revoke a still-valid
  // connection — or pass a stale/unowned id that fails the owned-by check and
  // wedges the migration on every retry.
  const currentConns = await svc.getAgentConnections(agentId);
  const union = Array.from(
    new Set([...currentConns.connections.map((c) => c.connectionId), connId]),
  );
  await svc.setAgentConnections(agentId, union);

  await deps.connectionRulesSync.adoptSources({
    agentId,
    fromSources: cred.secretIds.map((id) => `connection:${id}`),
    toSource: `connection:${connId}`,
  });

  const remaining = (await grantsPort.get(agentId)).grantedSecretIds.filter(
    (id) => !cred.secretIds.includes(id),
  );
  await grantsPort.setSecretGrants(agentId, remaining);
}

async function findGrantingAgents(
  deps: MigrateDeps,
  cred: LogicalCredential,
): Promise<string[]> {
  const grantsPort = createAgentGrantsPort(deps.k8sClient, cred.owner);
  const agents = new Set<string>();
  for (const id of cred.secretIds) {
    for (const g of await grantsPort.listAgentsGrantedSecret(id)) {
      agents.add(g.agentId);
    }
  }
  return Array.from(agents);
}

async function deleteLegacySecrets(
  deps: MigrateDeps,
  cred: LogicalCredential,
): Promise<void> {
  const grantsPort = createAgentGrantsPort(deps.k8sClient, cred.owner);
  // Twins first, primary last, so a retry after a partial delete is clean.
  for (const id of [...cred.twins.map((t) => t.id), cred.primary.id]) {
    const stillGranted = await grantsPort.listAgentsGrantedSecret(id);
    if (stillGranted.length > 0) continue;
    await deps.k8sClient.deleteSecret(legacySecretName(id));
  }
}

// ---- grouping -------------------------------------------------------------

function groupLogicalCredentials(
  owner: string,
  secrets: LegacySecret[],
): { credentials: LogicalCredential[]; skips: string[] } {
  const credentials: LogicalCredential[] = [];
  const skips: string[] = [];

  const byId = new Map(secrets.map((s) => [s.id, s]));
  const twinsByPrimary = new Map<string, LegacySecret[]>();
  for (const s of secrets) {
    if (!s.primarySecretId) continue;
    const list = twinsByPrimary.get(s.primarySecretId) ?? [];
    list.push(s);
    twinsByPrimary.set(s.primarySecretId, list);
  }

  // GitHub PAT pairs: two `generic` secrets sharing a display name, one on
  // api.github.com (Bearer), one on github.com (Basic). Linked by display name,
  // not primary-secret-id.
  const consumedAsPatGit = new Set<string>();
  const genericByDisplay = new Map<string, LegacySecret[]>();
  for (const s of secrets) {
    if (s.type !== "generic" || s.primarySecretId) continue;
    const list = genericByDisplay.get(s.displayName) ?? [];
    list.push(s);
    genericByDisplay.set(s.displayName, list);
  }
  const patApiHalves = new Set<string>();
  for (const group of genericByDisplay.values()) {
    const api = group.find((s) => s.hostPattern === "api.github.com");
    const git = group.find((s) => s.hostPattern === "github.com");
    if (api && git) {
      patApiHalves.add(api.id);
      consumedAsPatGit.add(git.id);
      credentials.push({
        owner,
        kind: "github-pat",
        templateId: GITHUB_PAT_TEMPLATE_ID,
        primary: api,
        twins: [git],
        secretIds: [api.id, git.id],
      });
    } else if (git && !api) {
      // Lone git-half: the bare PAT isn't recoverable in the form the
      // github-pat template expects, and re-baking would add hosts it never
      // had. Leave it for an operator.
      consumedAsPatGit.add(git.id);
      skips.push(
        `${git.id} (lone github.com PAT half — no api.github.com pair)`,
      );
    }
  }

  for (const s of secrets) {
    if (s.primarySecretId) continue; // a twin — folded into its primary below
    if (consumedAsPatGit.has(s.id) || patApiHalves.has(s.id)) continue; // PAT
    const twins = twinsByPrimary.get(s.id) ?? [];
    const templateId = providerTemplateId(s.type, s.authMode);
    credentials.push({
      owner,
      kind: templateId ? "provider" : "generic",
      templateId: templateId ?? CUSTOM_HEADER_TEMPLATE_ID,
      primary: s,
      twins,
      secretIds: [s.id, ...twins.map((t) => t.id)],
    });
  }

  // Orphan twins whose primary vanished.
  for (const [primaryId, twins] of twinsByPrimary) {
    if (byId.has(primaryId)) continue;
    for (const t of twins) {
      skips.push(`${t.id} (orphan twin — primary ${primaryId} missing)`);
    }
  }

  return { credentials, skips };
}

function providerTemplateId(
  type: string,
  authMode: LegacySecret["authMode"],
): string | null {
  switch (type) {
    case "anthropic":
      return authMode === "oauth" ? "anthropic-oauth" : "anthropic";
    case "openai":
      return "openai";
    case "ibm-litellm":
      return "ibm-litellm";
    case "bob":
      return "bob";
    default:
      return null;
  }
}

// ---- value recovery -------------------------------------------------------

/** Recover the bare credential from a legacy secret's baked SDS inline string.
 *  Query-param injections store the bare value; header injections store
 *  `valueFormat` with `{value}` substituted, so strip the format's fixed
 *  prefix/suffix. Returns null when the inline string doesn't match. */
function recoverValue(s: LegacySecret): string | null {
  if (s.queryParamName) return s.inlineString;
  const fmt = s.valueFormat ?? "{value}";
  const marker = fmt.indexOf("{value}");
  if (marker < 0) return null;
  const prefix = fmt.slice(0, marker);
  const suffix = fmt.slice(marker + "{value}".length);
  if (
    !s.inlineString.startsWith(prefix) ||
    !s.inlineString.endsWith(suffix) ||
    s.inlineString.length < prefix.length + suffix.length
  ) {
    return null;
  }
  return s.inlineString.slice(
    prefix.length,
    s.inlineString.length - suffix.length,
  );
}

// ---- helpers --------------------------------------------------------------

function deterministicId(prefix: string, legacyId: string): string {
  const h = createHash("sha256").update(legacyId).digest("hex").slice(0, 12);
  return `${prefix}${h}`;
}

/** Legacy display name, suffixed to dodge a `(owner, name)` collision with a
 *  connection that already owns it. */
async function freeName(
  repo: ConnectionsRepository,
  owner: string,
  base: string,
): Promise<string> {
  const taken = new Set(
    (await repo.listByOwner(owner)).map((c: Connection) => c.name),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
