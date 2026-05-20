/**
 * ADR-046 migration: fold legacy `agent-platform.ai/type=agent-instance`
 * ConfigMaps into their parent `type=agent` ConfigMaps, and remap every
 * Postgres row's `instance_id` to the parent `agent_id`.
 *
 * Why this exists: pre-merge, an Agent CM (definition: image, env, mounts)
 * and an Instance CM (runtime: desiredState, secretRef, env override) were
 * two separate K8s resources. Postgres rows referenced the Instance by name.
 * Post-merge, the Agent CM absorbs everything and the Instance is gone.
 * Postgres rows must be re-pointed at the Agent CM.
 *
 * Run as a Helm POST-upgrade hook. By that point the new controller is up
 * but unable to reconcile the old shape; this script repairs the world so
 * the next reconcile sees fully-merged Agent CMs.
 *
 * Idempotent: on a fresh install no instance CMs exist and the script is a
 * no-op; re-running after partial success picks up wherever it left off.
 *
 * Safety: deletes Instance CMs with `propagationPolicy=Orphan` so the
 * running StatefulSet + Service + NetworkPolicy + Envoy bootstrap aren't
 * cascade-deleted. The new controller adopts them on its next reconcile.
 */
import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import { createDb } from "db";

const LABEL_TYPE = "agent-platform.ai/type";
const LABEL_AGENT_REF = "agent-platform.ai/agent";
const TYPE_AGENT_INSTANCE = "agent-instance";
const SPEC_KEY = "spec.yaml";
const STATUS_KEY = "status.yaml";

const PROPAGATED_ANNOTATIONS = [
  "agent-platform.ai/last-activity",
  "agent-platform.ai/granted-secret-ids",
  "agent-platform.ai/granted-connection-ids",
  "agent-platform.ai/secrets-rev",
  "agent-platform.ai/active-session",
];

interface EnvVar {
  name: string;
  value: string;
}

interface InstanceSpec {
  name?: string;
  agentId?: string;
  desiredState?: "running" | "hibernated";
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
}

interface AgentSpec {
  version?: string;
  name?: string;
  image?: string;
  description?: string;
  mounts?: unknown;
  init?: string;
  env?: EnvVar[];
  resources?: unknown;
  imagePullPolicy?: string;
  storageSize?: string;
  skillPaths?: string[];
  desiredState?: "running" | "hibernated";
  secretRef?: string;
}

function mergeEnv(base: EnvVar[] = [], overlay: EnvVar[] = []): EnvVar[] {
  const seen = new Map<string, EnvVar>();
  for (const e of base) seen.set(e.name, e);
  for (const e of overlay) seen.set(e.name, e); // overlay wins on name collision
  return [...seen.values()];
}

function mergeSpecs(agent: AgentSpec, instance: InstanceSpec): AgentSpec {
  return {
    ...agent,
    desiredState: instance.desiredState ?? agent.desiredState ?? "running",
    secretRef: instance.secretRef ?? agent.secretRef,
    description: instance.description ?? agent.description,
    env: mergeEnv(agent.env, instance.env),
  };
}

const REMAP_TABLES = [
  "channels",
  "allowed_users",
  "telegram_threads",
  "sessions",
  "instance_skills",
  "instance_skill_publishes",
];

async function main() {
  const namespace = process.env.NAMESPACE;
  const databaseUrl = process.env.DATABASE_URL;
  if (!namespace) throw new Error("NAMESPACE env var is required");
  if (!databaseUrl) throw new Error("DATABASE_URL env var is required");

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const core = kc.makeApiClient(k8s.CoreV1Api);

  const { sql } = createDb(databaseUrl);

  process.stderr.write(`[migrate-fold-instances] scanning ns=${namespace}\n`);

  const list = await core.listNamespacedConfigMap({
    namespace,
    labelSelector: `${LABEL_TYPE}=${TYPE_AGENT_INSTANCE}`,
  });
  const instances = list.items;
  process.stderr.write(
    `[migrate-fold-instances] found ${instances.length} agent-instance ConfigMap(s)\n`,
  );

  if (instances.length === 0) {
    await sql.end();
    process.stderr.write("[migrate-fold-instances] nothing to do\n");
    return;
  }

  // Detect whether each table still has `instance_id` (pre-drizzle) or
  // already renamed to `agent_id` (post-drizzle). Each entry is the column
  // name to UPDATE; tables that no longer exist (instance_skills* renamed
  // to agent_skills*) drop out of the map entirely.
  const columnByTable = new Map<string, string>();
  for (const table of REMAP_TABLES) {
    const rows = (await sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = ${table}
         AND column_name IN ('instance_id', 'agent_id')
    `) as { column_name: string }[];
    const cols = new Set(rows.map((r) => r.column_name));
    if (cols.has("instance_id")) columnByTable.set(table, "instance_id");
    else if (cols.has("agent_id")) columnByTable.set(table, "agent_id");
  }

  let folded = 0;
  let orphaned = 0;
  let dbRemapTotal = 0;

  for (const inst of instances) {
    const instanceId = inst.metadata?.name;
    const agentId = inst.metadata?.labels?.[LABEL_AGENT_REF];
    if (!instanceId) continue;

    if (!agentId) {
      process.stderr.write(
        `[migrate-fold-instances] skipping orphan instance ${instanceId} (no agent ref)\n`,
      );
      orphaned++;
      continue;
    }

    // Fetch parent agent CM.
    let agentCm: k8s.V1ConfigMap;
    try {
      agentCm = await core.readNamespacedConfigMap({
        namespace,
        name: agentId,
      });
    } catch (err) {
      const apiErr = err as { code?: number };
      if (apiErr.code === 404) {
        process.stderr.write(
          `[migrate-fold-instances] parent agent ${agentId} missing for instance ${instanceId}; skipping\n`,
        );
        orphaned++;
        continue;
      }
      throw err;
    }

    // Merge specs.
    const instanceSpec = (yaml.load(inst.data?.[SPEC_KEY] ?? "") ??
      {}) as InstanceSpec;
    const agentSpec = (yaml.load(agentCm.data?.[SPEC_KEY] ?? "") ??
      {}) as AgentSpec;
    const merged = mergeSpecs(agentSpec, instanceSpec);

    // Carry annotations across.
    const carriedAnnotations: Record<string, string> = {};
    for (const k of PROPAGATED_ANNOTATIONS) {
      const v = inst.metadata?.annotations?.[k];
      if (v !== undefined) carriedAnnotations[k] = v;
    }

    // Patch the agent CM with merged spec + carried annotations + the
    // instance's status.yaml so the controller sees a consistent picture.
    const patchData: Record<string, string> = {
      [SPEC_KEY]: yaml.dump(merged),
    };
    const instanceStatus = inst.data?.[STATUS_KEY];
    if (instanceStatus) patchData[STATUS_KEY] = instanceStatus;

    await core.patchNamespacedConfigMap(
      {
        name: agentId,
        namespace,
        body: {
          metadata: { annotations: carriedAnnotations },
          data: patchData,
        },
      },
      k8s.setHeaderOptions("Content-Type", k8s.PatchStrategy.MergePatch),
    );

    // Remap Postgres rows in every table that references this instance id.
    for (const [table, column] of columnByTable) {
      const rows = await sql.unsafe(
        `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
        [agentId, instanceId],
      );
      dbRemapTotal += (rows as unknown as { count: number }).count ?? 0;
    }

    // Delete the instance CM with orphan propagation — the StatefulSet,
    // Service, NetworkPolicy etc. that were owner-ref'd to it will be
    // adopted by the new controller on its next reconcile of the now-
    // merged Agent CM.
    await core.deleteNamespacedConfigMap({
      name: instanceId,
      namespace,
      propagationPolicy: "Orphan",
    });

    folded++;
    process.stderr.write(
      `[migrate-fold-instances] folded ${instanceId} → ${agentId}\n`,
    );
  }

  process.stderr.write(
    `[migrate-fold-instances] done: folded=${folded} orphaned=${orphaned} dbRowsRemapped=${dbRemapTotal}\n`,
  );

  await sql.end();
}

main().catch((err) => {
  process.stderr.write(
    `[migrate-fold-instances] ERROR: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
