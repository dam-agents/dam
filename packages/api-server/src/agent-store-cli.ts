import { readFileSync, writeFileSync } from "node:fs";
import { createDb } from "db";
import {
  controlAgentStore,
  controlAgents,
  controlCrdSnapshots,
  controlUserBudgets,
  eq,
  sql,
} from "db";
import * as k8s from "@kubernetes/client-node";

import { configureLogger, getLogger } from "./core/logger.js";
import { securityLog } from "./core/security-log.js";
import {
  createApi,
  createK8sClient,
  currentClusterServer,
  type KubeObject,
} from "./modules/agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  LABEL_AGENT_REF,
} from "./modules/agents/infrastructure/labels.js";

const USERBUDGETS_PLURAL = "userbudgets";
import { agentStoreMarkerName } from "./modules/agent-store/fence.js";
import {
  frozenRefusals,
  readFrozenState,
} from "./modules/agent-store/frozen.js";
import {
  absentAbsorbedResources,
  attestedDigestMatches,
  restoreBody,
  rePointAction,
  rollbackVerdict,
  snapshotMembership,
  statusBody,
  type RestoreBody,
} from "./modules/agent-store/rollback.js";
import type { InstallIdentity } from "./modules/agent-store/absorb.js";
import { orderDocuments } from "./modules/agent-store/snapshot.js";
import { readAgentRows } from "./modules/agent-store/control-read.js";
import {
  archiveOf,
  encryptToRecipient,
  exportCrds,
  sha256Of,
} from "./modules/agent-store/exporter.js";
import {
  blockingRefusals,
  previewAgentStore,
  readConnectionGrants,
} from "./modules/agent-store/preview.js";

const usage = `usage: agent-store-cli <command>

  export-snapshot [--recipient <age public key>] [--force-recipient] [--out <file>]
      Write the switch's archive, encrypted to the install's
      agentStore.backup.recipient (or --recipient), from the database's snapshot
      table. Prints ciphertext. A --recipient that differs from the chart's is
      refused unless --force-recipient is given.

  export-crds [--out <directory>]
      Write the custom resources the rows currently describe, for inspection
      or diffing. Prints plaintext.

  repair-grants [--agent <id>] [--dry-run]
      Re-run the SQL -> custom-resource connection-grant fan-out for every
      Agent whose two sets disagree (or just --agent's), and report what remains.

  rollback [--dry-run]
      Restore the custom resources, re-point their children to the new UIDs,
      remove the anchors and clear the absorb. Refuses unless the store was
      absorbed and the cluster shows both Deployments frozen with no pod and no
      controller holding the Lease. A rerun after a finished rollback does
      nothing.

  contract-check --sha256 <hex>
      Refuse unless the install's archive is the one the operator attests.`;

const args = process.argv.slice(2);
const command = args[0] ?? "";
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string): boolean => args.includes(name);

const is404 = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause as { code: unknown }).code === 404;

const kubeConfig = new k8s.KubeConfig();
kubeConfig.loadFromDefault();
const dynamicApi = kubeConfig.makeApiClient(k8s.CustomObjectsApi);

const listDynamic = async (input: {
  group: string;
  version: string;
  plural: string;
  namespace: string;
  labelSelector: string;
}): Promise<Array<Record<string, unknown>>> => {
  try {
    const result = await dynamicApi.listNamespacedCustomObject(input);
    return ((result as { items?: Array<Record<string, unknown>> }).items ??
      []) as Array<Record<string, unknown>>;
  } catch (cause) {
    if (is404(cause)) return [];
    throw cause;
  }
};

const patchDynamic = async (input: {
  group: string;
  version: string;
  plural: string;
  namespace: string;
  name: string;
  body: unknown;
}): Promise<void> => {
  await dynamicApi.patchNamespacedCustomObject(
    input,
    k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
  );
};

const listLabelled = async (input: {
  api: k8s.CoreV1Api;
  apps: k8s.AppsV1Api;
  networking: k8s.NetworkingV1Api;
  kind: ChildKind;
  namespace: string;
  labelSelector: string;
}): Promise<Array<{ name: string; owners: k8s.V1OwnerReference[] }>> => {
  switch (input.kind) {
    case "StatefulSet": {
      const list = await input.apps.listNamespacedStatefulSet({
        namespace: input.namespace,
        labelSelector: input.labelSelector,
      });
      return (list.items ?? []).map((one) => ({
        name: one.metadata?.name ?? "",
        owners: one.metadata?.ownerReferences ?? [],
      }));
    }
    case "Service": {
      const list = await input.api.listNamespacedService({
        namespace: input.namespace,
        labelSelector: input.labelSelector,
      });
      return (list.items ?? []).map((one) => ({
        name: one.metadata?.name ?? "",
        owners: one.metadata?.ownerReferences ?? [],
      }));
    }
    case "ServiceAccount": {
      const list = await input.api.listNamespacedServiceAccount({
        namespace: input.namespace,
        labelSelector: input.labelSelector,
      });
      return (list.items ?? []).map((one) => ({
        name: one.metadata?.name ?? "",
        owners: one.metadata?.ownerReferences ?? [],
      }));
    }
    case "ConfigMap": {
      const list = await input.api.listNamespacedConfigMap({
        namespace: input.namespace,
        labelSelector: input.labelSelector,
      });
      return (list.items ?? []).map((one) => ({
        name: one.metadata?.name ?? "",
        owners: one.metadata?.ownerReferences ?? [],
      }));
    }
    case "Secret": {
      const list = await input.api.listNamespacedSecret({
        namespace: input.namespace,
        labelSelector: input.labelSelector,
      });
      return (list.items ?? []).map((one) => ({
        name: one.metadata?.name ?? "",
        owners: one.metadata?.ownerReferences ?? [],
      }));
    }
    case "NetworkPolicy": {
      const list = await input.networking.listNamespacedNetworkPolicy({
        namespace: input.namespace,
        labelSelector: input.labelSelector,
      });
      return (list.items ?? []).map((one) => ({
        name: one.metadata?.name ?? "",
        owners: one.metadata?.ownerReferences ?? [],
      }));
    }
    default: {
      const list = await listDynamic({
        group:
          input.kind === "Certificate"
            ? "cert-manager.io"
            : "security.istio.io",
        version: "v1",
        plural:
          input.kind === "Certificate"
            ? "certificates"
            : "authorizationpolicies",
        namespace: input.namespace,
        labelSelector: input.labelSelector,
      });
      return list.map((one) => ({
        name: String(
          (one.metadata as { name?: string } | undefined)?.name ?? "",
        ),
        owners: ((one.metadata as { ownerReferences?: k8s.V1OwnerReference[] })
          ?.ownerReferences ?? []) as k8s.V1OwnerReference[],
      }));
    }
  }
};

const patchOwners = async (input: {
  api: k8s.CoreV1Api;
  apps: k8s.AppsV1Api;
  networking: k8s.NetworkingV1Api;
  kind: ChildKind;
  namespace: string;
  name: string;
  owners: k8s.V1OwnerReference[];
}): Promise<void> => {
  const body = { metadata: { ownerReferences: input.owners } };
  switch (input.kind) {
    case "StatefulSet":
      await input.apps.patchNamespacedStatefulSet(
        { name: input.name, namespace: input.namespace, body },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
      );
      return;
    case "Service":
      await input.api.patchNamespacedService(
        { name: input.name, namespace: input.namespace, body },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
      );
      return;
    case "ServiceAccount":
      await input.api.patchNamespacedServiceAccount(
        { name: input.name, namespace: input.namespace, body },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
      );
      return;
    case "ConfigMap":
      await input.api.patchNamespacedConfigMap(
        { name: input.name, namespace: input.namespace, body },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
      );
      return;
    case "Secret":
      await input.api.patchNamespacedSecret(
        { name: input.name, namespace: input.namespace, body },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
      );
      return;
    case "NetworkPolicy":
      await input.networking.patchNamespacedNetworkPolicy(
        { name: input.name, namespace: input.namespace, body },
        k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
      );
      return;
    default:
      await patchDynamic({
        group:
          input.kind === "Certificate"
            ? "cert-manager.io"
            : "security.istio.io",
        version: "v1",
        plural:
          input.kind === "Certificate"
            ? "certificates"
            : "authorizationpolicies",
        namespace: input.namespace,
        name: input.name,
        body,
      });
  }
};

type ChildKind =
  | "StatefulSet"
  | "Service"
  | "ServiceAccount"
  | "ConfigMap"
  | "Secret"
  | "NetworkPolicy"
  | "Certificate"
  | "AuthorizationPolicy";

export const CHILD_KINDS: ChildKind[] = [
  "StatefulSet",
  "Service",
  "ServiceAccount",
  "ConfigMap",
  "Secret",
  "NetworkPolicy",
  "Certificate",
  "AuthorizationPolicy",
];

const isAnchorOrAgent = (ref: k8s.V1OwnerReference): boolean =>
  ref.kind === "Agent" ||
  (ref.kind === "ConfigMap" && ref.name.endsWith("-anchor"));

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};

const expandEnvRefs = (value: string): string =>
  value.replace(/\$\(([A-Z0-9_]+)\)/gu, (_, name: string) => {
    const resolved = process.env[name];
    if (resolved === undefined || resolved === "")
      throw new Error(
        `the connection string names $(${name}), which the environment does not carry`,
      );
    return resolved;
  });

const replaceDynamic = async (input: {
  plural: string;
  namespace: string;
  name: string;
  body: unknown;
}): Promise<string | undefined> => {
  const replaced = (await dynamicApi.replaceNamespacedCustomObject({
    group: "agent-platform.ai",
    version: "v1",
    ...input,
  })) as { metadata?: { resourceVersion?: string } };
  return replaced.metadata?.resourceVersion;
};

const replaceDynamicStatus = async (input: {
  plural: string;
  namespace: string;
  name: string;
  body: unknown;
}): Promise<void> => {
  await dynamicApi.replaceNamespacedCustomObjectStatus({
    group: "agent-platform.ai",
    version: "v1",
    ...input,
  });
};

const readMarker = async (
  api: k8s.CoreV1Api,
  namespace: string,
  name: string,
): Promise<Record<string, string> | null> => {
  try {
    const marker = await api.readNamespacedConfigMap({ name, namespace });
    return (marker.data ?? {}) as Record<string, string>;
  } catch (cause) {
    if (is404(cause)) return null;
    throw cause;
  }
};

const main = async (): Promise<void> => {
  const config = {
    databaseUrl: expandEnvRefs(
      env("DATABASE_URL") ??
        (() => {
          throw new Error("DATABASE_URL must be set");
        })(),
    ),
    databaseCaCertPath: env("DATABASE_CA_CERT_PATH"),
    namespace: env("NAMESPACE") ?? "platform-agents",
    releaseNamespace: env("PLATFORM_RELEASE_NAMESPACE") ?? "default",
    releaseName:
      env("PLATFORM_RELEASE_NAME") ??
      (() => {
        throw new Error("PLATFORM_RELEASE_NAME must be set");
      })(),
    agentStoreMarker: env("PLATFORM_AGENT_STORE_MARKER"),
    agentStoreFrozen: env("PLATFORM_AGENT_STORE_FROZEN") === "true",
    agentStoreBackupRecipient: env("AGENT_STORE_BACKUP_RECIPIENT"),
    logLevel: (env("LOG_LEVEL") ?? "info") as
      "error" | "warn" | "info" | "debug",
  };
  configureLogger({ level: config.logLevel, base: { command } });
  const log = getLogger();
  const { db, sql: sqlClient } = createDb(config.databaseUrl, {
    tls: config.databaseCaCertPath
      ? { ca: readFileSync(config.databaseCaCertPath, "utf8") }
      : undefined,
  });
  // UNIT_BOUNDARY_DESCRIPTION: the pool's idle timeout keeps the process alive for half a
  // UNIT_BOUNDARY_DESCRIPTION: minute after the command is done, which a person waiting on a
  // UNIT_BOUNDARY_DESCRIPTION: rollback reads as a hung command. Every successful path closes it.
  const finish = async (): Promise<void> => {
    await sqlClient.end({ timeout: 5 }).catch(() => {});
  };
  const { api } = createApi(config.namespace);
  const client = createK8sClient(api, config.namespace);
  const markerName =
    config.agentStoreMarker ?? agentStoreMarkerName(config.releaseName);

  const createComplete = async (
    plural: string,
    resource: { name: string },
    restored: RestoreBody,
  ): Promise<void> => {
    const created = await client.createCustomObject(plural, restored.body);
    const status = statusBody(restored.status);
    if (plural === AGENTS_PLURAL && status !== undefined)
      await replaceDynamicStatus({
        plural,
        namespace: config.namespace,
        name: String(created.metadata?.name ?? resource.name),
        body: {
          apiVersion: "agent-platform.ai/v1",
          kind: "Agent",
          metadata: {
            name: String(created.metadata?.name ?? resource.name),
            namespace: config.namespace,
            resourceVersion: created.metadata?.resourceVersion,
          },
          status,
        },
      });
  };

  const replaceComplete = async (
    plural: string,
    name: string,
    restored: RestoreBody,
  ): Promise<void> => {
    const resourceVersion = await replaceDynamic({
      plural,
      namespace: config.namespace,
      name,
      body: restored.body,
    });
    const status = statusBody(restored.status);
    if (plural === AGENTS_PLURAL && status !== undefined)
      await replaceDynamicStatus({
        plural,
        namespace: config.namespace,
        name,
        body: {
          apiVersion: "agent-platform.ai/v1",
          kind: "Agent",
          metadata: { name, namespace: config.namespace, resourceVersion },
          status,
        },
      });
  };

  switch (command) {
    case "export-snapshot": {
      const configured = config.agentStoreBackupRecipient;
      const requested = flag("--recipient");
      if (requested && configured && requested !== configured) {
        const message = `--recipient ${requested} is not the install's agentStore.backup.recipient ${configured}: a file encrypted to another key is one the install's key holder cannot open. Print this and pass --force-recipient if that is really intended.`;
        if (!has("--force-recipient")) throw new Error(message);
        process.stderr.write(`warning: ${message}\n`);
      }
      const recipient = requested ?? configured;
      if (!recipient)
        throw new Error(
          "export-snapshot needs agentStore.backup.recipient (AGENT_STORE_BACKUP_RECIPIENT) or --recipient <age public key>",
        );
      process.stderr.write(`encrypting to ${recipient}\n`);
      const captured = await db
        .select({ at: controlCrdSnapshots.capturedAt })
        .from(controlCrdSnapshots)
        .orderBy(sql`${controlCrdSnapshots.capturedAt} DESC`)
        .limit(1);
      const at = captured[0]?.at;
      if (!at) throw new Error("the database holds no absorb snapshot");
      const docs = orderDocuments(
        await db
          .select()
          .from(controlCrdSnapshots)
          .where(eq(controlCrdSnapshots.capturedAt, at)),
      );
      const archive = Buffer.from(
        docs.map((doc) => doc.yaml).join("---\n"),
        "utf8",
      );
      const ciphertext = await encryptToRecipient(archive, recipient);
      const out = flag("--out");
      if (out) {
        writeFileSync(out, ciphertext, { mode: 0o600 });
        process.stderr.write(
          `wrote ${docs.length} document(s), sha256 ${sha256Of(archive)}, to ${out} as age ciphertext to ${recipient}\n`,
        );
      } else process.stdout.write(ciphertext);
      await finish();
      return;
    }

    case "export-crds": {
      const agents = await readAgentRows(db);
      const budgets = await db.select().from(controlUserBudgets);
      const resources = exportCrds({ agents, budgets });
      const out = flag("--out");
      if (out) {
        for (const resource of resources)
          writeFileSync(
            `${out.replace(/\/+$/u, "")}/${resource.kind}-${resource.name}.yaml`,
            resource.yaml,
            { mode: 0o600 },
          );
        process.stderr.write(
          `wrote ${resources.length} resource(s) to ${out}; the YAML is plaintext\n`,
        );
      } else process.stdout.write(archiveOf(resources));
      await finish();
      return;
    }

    case "repair-grants": {
      const dryRun = has("--dry-run");
      const only = flag("--agent");
      const previewOnce = async () => {
        const agents = (await client.listCustomObjects(AGENTS_PLURAL)).filter(
          (cr) => only === undefined || cr.metadata?.name === only,
        );
        const ids = agents.map((cr) => cr.metadata?.name ?? "").filter(Boolean);
        const grants = await readConnectionGrants(db, ids);
        const byAgent = new Map<string, Set<string>>();
        for (const grant of grants) {
          const set = byAgent.get(grant.agentId) ?? new Set<string>();
          set.add(grant.connectionId);
          byAgent.set(grant.agentId, set);
        }
        return {
          byAgent,
          preview: previewAgentStore({
            agents,
            budgets: [],
            grants,
            defaults: { cpuLimit: "1", memoryLimit: "2Gi" },
            switchedAt: new Date().toISOString(),
          }),
        };
      };
      const before = await previewOnce();
      const mismatched = new Map(
        [
          ...before.preview.connectionGrants.onlyInResource,
          ...before.preview.connectionGrants.onlyInDatabase,
        ].map((one) => [one.id, one.reason]),
      );
      for (const [id, reason] of mismatched) {
        const desired = [...(before.byAgent.get(id) ?? new Set())].sort();
        process.stderr.write(
          `${dryRun ? "would re-grant" : "re-granting"} ${id}: ${desired.join(", ") || "(nothing)"}\n`,
        );
        if (dryRun) continue;
        await client.patchCustomObject(AGENTS_PLURAL, id, {
          spec: { grantedConnectionIds: desired },
        });
        securityLog("warn", "agentStore.grantFanOutRepair", {
          category: "credential",
          actor: "agent-store-cli",
          actorKind: "system",
          agentId: id,
          decision: "allow",
          reason: `the resource and the database disagreed (${reason}); the database's set was projected onto the resource`,
        });
      }
      const after = dryRun ? before : await previewOnce();
      const remaining = blockingRefusals(after.preview).filter((line) =>
        line.includes("connection grants"),
      );
      process.stderr.write(
        `${remaining.length} mismatch(es) remain${dryRun ? " (dry run)" : ""}\n`,
      );
      if (!dryRun && remaining.length > 0) process.exitCode = 1;
      await finish();
      return;
    }

    case "rollback": {
      const dryRun = has("--dry-run");
      const state = await db
        .select()
        .from(controlAgentStore)
        .where(eq(controlAgentStore.id, 1))
        .limit(1);
      const store = state[0];
      if (store === undefined)
        throw new Error(
          "the database has no control.agent_store row: this is not an install's database",
        );
      const marker = await readMarker(api, config.namespace, markerName);
      const agents = await readAgentRows(db);
      const budgets = await db.select().from(controlUserBudgets);
      const resources = exportCrds({ agents, budgets });
      const restored = new Map(resources.map((one) => [one.name, one]));
      const existingAgents = await client.listCustomObjects(AGENTS_PLURAL);
      const existingBudgets =
        await client.listCustomObjects(USERBUDGETS_PLURAL);
      const liveInstall: InstallIdentity = {
        releaseName: config.releaseName,
        namespace: config.namespace,
        apiServer: currentClusterServer(),
      };
      const recordedInstall =
        (store.absorbReport as { install?: InstallIdentity } | null)?.install ??
        null;
      const verdict = rollbackVerdict({
        absorbedAt: store.absorbedAt,
        markerStore: marker?.store ?? null,
        markerAbsorbedAt: marker?.["absorbed-at"] ?? null,
        install: recordedInstall,
        liveInstall,
        agentRows: agents.length,
        liveAgents: existingAgents.length,
      });
      if (verdict.action === "noop") {
        process.stderr.write(`nothing to roll back: ${verdict.reason}\n`);
        await finish();
        return;
      }
      if (verdict.action === "refuse")
        throw new Error(`rollback refuses: ${verdict.reason}`);

      const latest = await db
        .select({ at: controlCrdSnapshots.capturedAt })
        .from(controlCrdSnapshots)
        .orderBy(sql`${controlCrdSnapshots.capturedAt} DESC`)
        .limit(1);
      const capturedAt = latest[0]?.at;
      const membership = snapshotMembership(
        capturedAt === undefined
          ? []
          : await db
              .select({
                kind: controlCrdSnapshots.kind,
                name: controlCrdSnapshots.name,
                uid: controlCrdSnapshots.uid,
              })
              .from(controlCrdSnapshots)
              .where(eq(controlCrdSnapshots.capturedAt, capturedAt)),
      );

      const frozen = await readFrozenState({
        apps: kubeConfig.makeApiClient(k8s.AppsV1Api),
        api,
        leases: kubeConfig.makeApiClient(k8s.CoordinationV1Api),
        namespace: config.releaseNamespace,
        leaseNamespace: config.namespace,
        releaseName: config.releaseName,
        leaseName: `${config.releaseName}-controller`,
      });
      const frozenProblems = frozenRefusals(frozen);
      if (frozenProblems.length > 0)
        throw new Error(
          `rollback refuses: the cluster is not frozen. ${frozenProblems.join(" ")}`,
        );
      process.stderr.write(
        "the cluster is frozen: both Deployments render the freeze, run no replica and have no pod, and no controller holds the Lease\n",
      );

      const apps = kubeConfig.makeApiClient(k8s.AppsV1Api);
      const networking = kubeConfig.makeApiClient(k8s.NetworkingV1Api);
      for (const resource of resources) {
        const kind =
          resource.kind === "Agent" ? AGENTS_PLURAL : USERBUDGETS_PLURAL;
        const live = await client.getCustomObject(kind, resource.name);
        process.stderr.write(
          `${live ? "replacing" : "creating"} ${resource.kind} ${resource.name}\n`,
        );
        if (dryRun) continue;
        const body = restoreBody({
          resource,
          live,
          namespace: config.namespace,
        });
        if (live === null) await createComplete(kind, resource, body);
        else await replaceComplete(kind, resource.name, body);
      }
      const deletions = (
        [
          {
            kind: "Agent" as const,
            plural: AGENTS_PLURAL,
            live: existingAgents,
          },
          {
            kind: "UserBudget" as const,
            plural: USERBUDGETS_PLURAL,
            live: existingBudgets,
          },
        ] as const
      ).flatMap((one) => {
        const removed = absentAbsorbedResources({
          kind: one.kind,
          live: one.live.map((cr) => ({
            name: cr.metadata?.name ?? "",
            uid: cr.metadata?.uid ?? null,
          })),
          restored: new Set(restored.keys()),
          membership,
        });
        const kept = one.live
          .map((cr) => cr.metadata?.name ?? "")
          .filter((name) => name !== "" && !restored.has(name))
          .filter((name) => !removed.includes(name));
        for (const name of kept)
          process.stderr.write(
            `leaving ${one.kind} ${name}: it has no row but was not part of an absorbed fleet\n`,
          );
        return removed.map((name) => ({ ...one, name }));
      });
      for (const one of deletions) {
        process.stderr.write(
          `deleting ${one.kind} ${one.name}: it was absorbed and its row is gone\n`,
        );
        if (!dryRun) await client.deleteCustomObject(one.plural, one.name);
      }

      for (const resource of resources) {
        if (resource.kind !== "Agent") continue;
        const live = await client.getCustomObject(AGENTS_PLURAL, resource.name);
        const decision = rePointAction({
          dryRun,
          liveUid: live?.metadata?.uid ?? null,
        });
        if (decision.action === "skip") {
          process.stderr.write(
            `would create Agent ${resource.name} and re-point its children to its new uid\n`,
          );
          continue;
        }
        if (decision.action === "throw")
          throw new Error(
            `the restored Agent ${resource.name} has no uid: re-pointing its children would orphan them`,
          );
        const uid = decision.uid;
        const reference: k8s.V1OwnerReference = {
          apiVersion: "agent-platform.ai/v1",
          kind: "Agent",
          name: resource.name,
          uid,
          controller: true,
          blockOwnerDeletion: true,
        };
        const labelSelector = `${LABEL_AGENT_REF}=${resource.name}`;
        for (const kind of CHILD_KINDS) {
          const children = await listLabelled({
            api,
            apps,
            networking,
            kind,
            namespace: config.namespace,
            labelSelector,
          });
          for (const child of children) {
            if (kind === "ConfigMap" && child.name.endsWith("-anchor"))
              continue;
            const owners = child.owners.filter(
              (ref) => !isAnchorOrAgent(ref) && ref.uid !== uid,
            );
            process.stderr.write(
              `re-pointing ${kind} ${child.name} to Agent ${resource.name} (${uid})\n`,
            );
            if (dryRun) continue;
            await patchOwners({
              api,
              apps,
              networking,
              kind,
              namespace: config.namespace,
              name: child.name,
              owners: [...owners, reference],
            });
          }
        }
      }

      for (const resource of dryRun ? [] : resources) {
        if (resource.kind !== "Agent") continue;
        const labelSelector = `${LABEL_AGENT_REF}=${resource.name}`;
        for (const kind of CHILD_KINDS) {
          const children = await listLabelled({
            api,
            apps,
            networking,
            kind,
            namespace: config.namespace,
            labelSelector,
          });
          const stale = children.find((child) =>
            child.owners.some(
              (ref) => ref.kind === "ConfigMap" && ref.name.endsWith("-anchor"),
            ),
          );
          if (stale)
            throw new Error(
              `${kind} ${stale.name} still references an anchor after the re-point: refusing to clear the absorb`,
            );
        }
      }

      for (const resource of resources) {
        if (resource.kind !== "Agent") continue;
        const anchor = `${resource.name}-anchor`;
        process.stderr.write(
          `${dryRun ? "would delete" : "deleting"} the anchor ${anchor}, orphaning nothing\n`,
        );
        if (dryRun) continue;
        try {
          await api.deleteNamespacedConfigMap({
            name: anchor,
            namespace: config.namespace,
            propagationPolicy: "Orphan",
          });
        } catch (cause) {
          if (!is404(cause)) throw cause;
        }
      }

      if (!dryRun) {
        try {
          await api.deleteNamespacedConfigMap({
            name: markerName,
            namespace: config.namespace,
          });
        } catch (cause) {
          if (!is404(cause)) throw cause;
        }
        await db.transaction(async (tx) => {
          await tx.delete(controlAgents);
          await tx.delete(controlUserBudgets);
          await tx
            .update(controlAgentStore)
            .set({
              absorbedAt: null,
              anchorsEnsuredAt: null,
              switchCompletedAt: null,
              controllerHolder: null,
            })
            .where(eq(controlAgentStore.id, 1));
        });
      }
      log.info(
        { dryRun, resources: resources.length },
        "agentStore.rollback.complete",
      );
      process.stderr.write(
        `rollback ${dryRun ? "checked" : "complete"}: ${resources.length} resource(s) restored; pin the release before the switch${
          config.agentStoreFrozen
            ? " and clear agentStore.frozen when you deploy it"
            : ""
        }, and expect the composition to create no anchors in CR mode\n`,
      );
      await finish();
      return;
    }

    case "contract-check": {
      const expected = flag("--sha256");
      if (!expected) throw new Error("contract-check needs --sha256 <hex>");
      const rows = await db
        .select({
          backupRef: controlAgentStore.backupRef,
          absorbReport: controlAgentStore.absorbReport,
        })
        .from(controlAgentStore)
        .where(eq(controlAgentStore.id, 1))
        .limit(1);
      const backupRef = rows[0]?.backupRef ?? null;
      const report = rows[0]?.absorbReport as
        { backup?: { sha256?: string } } | null | undefined;
      const recorded = report?.backup?.sha256 ?? null;
      if (backupRef === null || !attestedDigestMatches(recorded, expected))
        throw new Error(
          `the install's verified archive is ${backupRef ?? "absent"} with digest ${recorded ?? "absent"}, not the one attesting sha256 ${expected}: the contract release must not delete the custom resources`,
        );
      process.stderr.write(
        "the install's archive matches the attested digest\n",
      );
      await finish();
      return;
    }

    default:
      process.stderr.write(`${usage}\n`);
      process.exitCode = 2;
      await finish();
  }
};

await main();
