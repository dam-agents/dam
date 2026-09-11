import { execFileSync } from "node:child_process";
import { agentRecords, createDb, secrets, userBudgets } from "db";
import {
  agentRecordFromCr,
  budgetRowFromCr,
  secretRowFromK8s,
  type K8sObject,
} from "./modules/migration/domain/from-kubernetes.js";

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

async function main(): Promise<void> {
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

  for (const secret of credentials) {
    const row = secretRowFromK8s(secret);
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
    `imported ${agents.length} agent(s), ${credentials.length} credential(s), ${budgets.length} budget(s)\n`,
  );
  await sql.end();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
