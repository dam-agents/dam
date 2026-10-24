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
  type KubeObject,
} from "./modules/agents/infrastructure/k8s.js";
import {
  AGENTS_PLURAL,
  LABEL_AGENT_REF,
} from "./modules/agents/infrastructure/labels.js";

const USERBUDGETS_PLURAL = "userbudgets";
import { agentStoreMarkerName } from "./modules/agent-store/fence.js";
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

  export-snapshot --recipient <age public key> [--out <file>]
      Write the switch's archive, encrypted to the operator's key, from the
      database's snapshot table. Prints ciphertext.

  export-crds [--out <directory>]
      Write the custom resources the rows currently describe, for inspection
      or diffing. Prints plaintext.

  repair-grants [--dry-run]
      Re-run the SQL -> custom-resource connection-grant fan-out for every
      Agent whose two sets disagree, and report what remains.

  rollback [--dry-run]
      Restore the custom resources, re-point their children to the new UIDs,
      remove the anchors and clear the absorb. Refuses unless the components
      are frozen.

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
  | "Certificate"
  | "AuthorizationPolicy";

const CHILD_KINDS: ChildKind[] = [
  "StatefulSet",
  "Service",
  "ServiceAccount",
  "ConfigMap",
  "Secret",
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
  const { db } = createDb(config.databaseUrl, {
    tls: config.databaseCaCertPath
      ? { ca: readFileSync(config.databaseCaCertPath, "utf8") }
      : undefined,
  });
  const { api } = createApi(config.namespace);
  const client = createK8sClient(api, config.namespace);
  const markerName =
    config.agentStoreMarker ?? agentStoreMarkerName(config.releaseName);

  switch (command) {
    case "export-snapshot": {
      const recipient = flag("--recipient") ?? config.agentStoreBackupRecipient;
      if (!recipient)
        throw new Error(
          "export-snapshot needs --recipient <age public key> or AGENT_STORE_BACKUP_RECIPIENT (agentStore.backup.recipient)",
        );
      const captured = await db
        .select({ at: controlCrdSnapshots.capturedAt })
        .from(controlCrdSnapshots)
        .orderBy(sql`${controlCrdSnapshots.capturedAt} DESC`)
        .limit(1);
      const at = captured[0]?.at;
      if (!at) throw new Error("the database holds no absorb snapshot");
      const docs = await db
        .select()
        .from(controlCrdSnapshots)
        .where(eq(controlCrdSnapshots.capturedAt, at))
        .orderBy(controlCrdSnapshots.kind, controlCrdSnapshots.name);
      const archive = Buffer.from(
        docs.map((doc) => doc.yaml).join("---\n"),
        "utf8",
      );
      const ciphertext = await encryptToRecipient(archive, recipient);
      const out = flag("--out");
      if (out) {
        writeFileSync(out, ciphertext, { mode: 0o600 });
        process.stderr.write(
          `wrote ${docs.length} document(s), sha256 ${sha256Of(archive)}, to ${out} as age ciphertext\n`,
        );
      } else process.stdout.write(ciphertext);
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
          );
        process.stderr.write(
          `wrote ${resources.length} resource(s) to ${out}; the YAML is plaintext\n`,
        );
      } else process.stdout.write(archiveOf(resources));
      return;
    }

    case "repair-grants": {
      const dryRun = has("--dry-run");
      const previewOnce = async () => {
        const agents = await client.listCustomObjects(AGENTS_PLURAL);
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
      return;
    }

    case "rollback": {
      if (!config.agentStoreFrozen)
        throw new Error(
          "rollback refuses: set PLATFORM_AGENT_STORE_FROZEN=true and roll both components down first, or their writes race the restore",
        );
      const dryRun = has("--dry-run");
      const agents = await readAgentRows(db);
      const budgets = await db.select().from(controlUserBudgets);
      const resources = exportCrds({ agents, budgets });
      const byName = new Map(resources.map((one) => [one.name, one]));

      const existingAgents = await client.listCustomObjects(AGENTS_PLURAL);
      const existingBudgets =
        await client.listCustomObjects(USERBUDGETS_PLURAL);
      for (const resource of resources) {
        const exists = (
          resource.kind === "Agent" ? existingAgents : existingBudgets
        ).some((one) => one.metadata?.name === resource.name);
        process.stderr.write(
          `${exists ? "updating" : "creating"} ${resource.kind} ${resource.name}\n`,
        );
        if (dryRun) continue;
        const body = resource.resource;
        if (exists)
          await client.patchCustomObject(
            resource.kind === "Agent" ? AGENTS_PLURAL : USERBUDGETS_PLURAL,
            resource.name,
            { metadata: body.metadata, spec: body.spec },
          );
        else
          await client.createCustomObject(
            resource.kind === "Agent" ? AGENTS_PLURAL : USERBUDGETS_PLURAL,
            body,
          );
      }
      for (const cr of existingAgents) {
        const name = cr.metadata?.name ?? "";
        if (name === "" || byName.has(name)) continue;
        process.stderr.write(`deleting Agent ${name}: it has no row\n`);
        if (!dryRun) await client.deleteCustomObject(AGENTS_PLURAL, name);
      }

      const apps = kubeConfig.makeApiClient(k8s.AppsV1Api);
      for (const resource of resources) {
        if (resource.kind !== "Agent") continue;
        const live = await client.getCustomObject(AGENTS_PLURAL, resource.name);
        const uid = live?.metadata?.uid;
        if (!uid)
          throw new Error(
            `the restored Agent ${resource.name} has no uid: re-pointing its children would orphan them`,
          );
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
            if (
              owners.length === child.owners.length &&
              child.owners.some((ref) => ref.uid === uid)
            )
              continue;
            process.stderr.write(
              `re-pointing ${kind} ${child.name} to Agent ${resource.name} (${uid})\n`,
            );
            if (dryRun) continue;
            await patchOwners({
              api,
              apps,
              kind,
              namespace: config.namespace,
              name: child.name,
              owners: [...owners, reference],
            });
          }
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

      for (const resource of dryRun ? [] : resources) {
        if (resource.kind !== "Agent") continue;
        const labelSelector = `${LABEL_AGENT_REF}=${resource.name}`;
        for (const kind of CHILD_KINDS) {
          const children = await listLabelled({
            api,
            apps,
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

      if (!dryRun) {
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
        try {
          await api.deleteNamespacedConfigMap({
            name: markerName,
            namespace: config.namespace,
          });
        } catch (cause) {
          if (!is404(cause)) throw cause;
        }
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
        }\n`,
      );
      return;
    }

    case "contract-check": {
      const expected = flag("--sha256");
      if (!expected) throw new Error("contract-check needs --sha256 <hex>");
      const rows = await db
        .select({ backupRef: controlAgentStore.backupRef })
        .from(controlAgentStore)
        .where(eq(controlAgentStore.id, 1))
        .limit(1);
      const backupRef = rows[0]?.backupRef ?? null;
      if (backupRef === null || !backupRef.includes(expected))
        throw new Error(
          `the install's verified archive is ${backupRef ?? "absent"}, not the one attesting sha256 ${expected}: the contract release must not delete the custom resources`,
        );
      process.stderr.write(
        "the install's archive matches the attested digest\n",
      );
      return;
    }

    default:
      process.stderr.write(`${usage}\n`);
      process.exitCode = 2;
  }
};

await main();
