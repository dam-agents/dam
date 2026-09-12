import { execFileSync } from "node:child_process";
import {
  agentRecords,
  connections,
  createDb,
  eq,
  secrets,
  userBudgets,
} from "db";
import {
  agentRecordFromCr,
  budgetRowFromCr,
  rehomeRefs,
  secretRowFromK8s,
  type K8sObject,
} from "./modules/migration/domain/from-kubernetes.js";
import {
  planWorkspace,
  type MountedVolume,
} from "./modules/migration/domain/workspace-plan.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one-shot move of an install's agents,
 * credentials and budget ceilings out of the Kubernetes API and into the
 * database, for an operator upgrading from the release that kept them there.
 *
 * It reads with the cluster's own client rather than a Kubernetes library:
 * this runs once per install and is the only thing in the tree that still
 * knows the old shape, so it is not worth a dependency the rest of the
 * platform spent a rewrite removing.
 *
 * Connections are the exception to "everything else was already in Postgres
 * and needs nothing": the row stays where it is, but it carries the address of
 * a secret this run has just moved, so it is re-addressed rather than left
 * pointing at a store that no longer exists.
 *
 * Every write is an upsert keyed the way the table is, so an interrupted run
 * is re-runnable and a second run is a no-op. It writes no observed state and
 * starts nothing: the node's supervisor does that when it is started
 * afterwards, which is also why this must finish first.
 */
const NAMESPACE = process.env.MIGRATE_NAMESPACE ?? "platform";

function kubectlList(...selector: string[]): K8sObject[] {
  const out = execFileSync(
    "kubectl",
    ["-n", NAMESPACE, "get", ...selector, "-o", "json"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out) as { items?: K8sObject[] };
  return parsed.items ?? [];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Says where each agent's volumes have to end up,
 * for the step that moves the bytes. That step is shell — it is tar through a
 * pipe — but which volume lands where is the same decision the rest of this
 * migration makes, so it is made here once rather than spelled out again in a
 * second language.
 *
 * The home is whichever volume everything else sits inside. The layout is read
 * from the workload that owns the volumes rather than from the agent's own
 * definition: the definition carries mounts only when someone
 * asked for unusual ones, and an install running entirely on defaults declares
 * none at all. The workload always names what it actually mounted, and it
 * outlives the agent being asleep.
 */
function planWorkspaces(): void {
  for (const sts of kubectlList("statefulset")) {
    const name = sts.metadata?.name;
    const spec = sts.spec as
      | {
          volumeClaimTemplates?: { metadata?: { name?: string } }[];
          template?: {
            spec?: {
              containers?: {
                volumeMounts?: { name?: string; mountPath?: string }[];
              }[];
            };
          };
        }
      | undefined;
    if (!name || !name.startsWith("agent-") || name.endsWith("-gateway"))
      continue;
    const claims = new Set(
      (spec?.volumeClaimTemplates ?? []).flatMap((v) =>
        v.metadata?.name ? [v.metadata.name] : [],
      ),
    );
    const volumes: MountedVolume[] = [];
    for (const container of spec?.template?.spec?.containers ?? []) {
      for (const mount of container.volumeMounts ?? []) {
        if (!mount.name || !mount.mountPath || !claims.has(mount.name))
          continue;
        if (volumes.some((v) => v.path === mount.mountPath)) continue;
        volumes.push({
          claimName: `${mount.name}-${name}-0`,
          path: mount.mountPath,
        });
      }
    }
    if (volumes.length === 0) continue;
    const home = volumes.reduce((a, b) =>
      a.path.length <= b.path.length ? a : b,
    ).path;
    const plan = planWorkspace(home, volumes);
    for (const move of plan.moves) {
      process.stdout.write(`${JSON.stringify({ agentId: name, ...move })}\n`);
    }
    for (const left of plan.unplaceable) {
      process.stderr.write(
        `${name}: ${left.claimName} was mounted at ${left.path}, outside the agent's home, and has nowhere to go on a node\n`,
      );
    }
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "plan-workspaces") return planWorkspaces();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { db, sql } = createDb(url);

  const agents = kubectlList("agents.agent-platform.ai");
  const credentials = kubectlList(
    "secrets",
    "-l",
    "agent-platform.ai/managed-by=api-server",
  );
  const budgets = kubectlList("userbudgets.agent-platform.ai");

  for (const cr of agents) {
    const row = agentRecordFromCr(cr);
    await db
      .insert(agentRecords)
      .values({ ...row, status: {} })
      .onConflictDoUpdate({
        target: agentRecords.id,
        set: {
          owner: row.owner,
          templateId: row.templateId,
          annotations: row.annotations,
          spec: row.spec,
        },
      });
  }

  const moved = new Map<string, string>();
  for (const secret of credentials) {
    const row = secretRowFromK8s(secret);
    moved.set(secret.metadata?.name ?? "", row.path);
    await db
      .insert(secrets)
      .values(row)
      .onConflictDoUpdate({
        target: [secrets.storeId, secrets.path],
        set: {
          owner: row.owner,
          purpose: row.purpose,
          metadata: row.metadata,
          fields: row.fields,
        },
      });
  }

  let rehomed = 0;
  for (const conn of await db.select().from(connections)) {
    const auth = rehomeRefs(conn.auth, moved);
    if (JSON.stringify(auth) === JSON.stringify(conn.auth)) continue;
    await db
      .update(connections)
      .set({ auth })
      .where(eq(connections.id, conn.id));
    rehomed += 1;
  }

  for (const cr of budgets) {
    const row = budgetRowFromCr(cr);
    await db
      .insert(userBudgets)
      .values(row)
      .onConflictDoUpdate({
        target: userBudgets.owner,
        set: { cpu: row.cpu, memory: row.memory },
      });
  }

  process.stdout.write(
    `imported ${agents.length} agent(s), ${credentials.length} credential(s), ${budgets.length} budget(s); re-addressed ${rehomed} connection(s)\n`,
  );
  await sql.end();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
