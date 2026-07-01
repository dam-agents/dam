/**
 * Admin entrypoint for the secrets→connections migration, dry-run only.
 *
 *   node dist/migrations/secrets-to-connections.js --dry-run
 *
 * Runs in the api-server image with the api-server ServiceAccount and reports
 * the per-credential mapping (template, env it will carry, target connection
 * id) and skips, mutating nothing. The live migration runs automatically on
 * api-server boot; this is the pre-production eyeball check.
 *
 * Removed by the #1273 controller-cleanup follow-up alongside the migration
 * module.
 */
import { readFileSync } from "node:fs";
import { createDb } from "db";
import { loadConfig } from "../config.js";
import {
  createApi,
  createK8sClient,
} from "../modules/agents/infrastructure/k8s.js";
import {
  createKubernetesSecretStore,
  createSecretStoreRegistry,
} from "../modules/secret-store/index.js";
import { createConnectionsRepository } from "../modules/connections/infrastructure/connections-repository.js";
import { createConnectionRulesSyncAdapter } from "../modules/egress-rules/compose.js";
import { migrateSecretsToConnections } from "../modules/connections/migration/secrets-to-connections.js";

if (!process.argv.includes("--dry-run")) {
  process.stderr.write(
    "secrets-to-connections: refusing to run without --dry-run " +
      "(the live migration runs automatically on api-server boot)\n",
  );
  process.exit(1);
}

const config = loadConfig();
const { api } = createApi(config.namespace);
const k8sClient = createK8sClient(api, config.namespace);
const dbTls = {
  ca: config.databaseCaCertPath
    ? readFileSync(config.databaseCaCertPath, "utf8")
    : undefined,
};
const { db, sql } = createDb(config.databaseUrl, dbTls);

const secretStores = createSecretStoreRegistry();
secretStores.register(createKubernetesSecretStore({ k8s: k8sClient }));

const result = await migrateSecretsToConnections({
  k8sClient,
  repo: createConnectionsRepository(db),
  secretStore: secretStores.default(),
  // Dry-run returns before any create/flip, so the connections service is
  // never invoked — fail loud if that assumption ever breaks.
  connectionsServiceFor: () => {
    throw new Error("dry-run must not create or flip connections");
  },
  connectionRulesSync: createConnectionRulesSyncAdapter(db),
  log: (m) => process.stderr.write(`${m}\n`),
  dryRun: true,
});

for (const line of result.report) process.stdout.write(`${line}\n`);
process.stderr.write(
  `\nsecrets-to-connections (dry-run): ${result.migrated} to migrate, ` +
    `${result.skipped} skipped, ${result.failed} unreadable.\n`,
);

await sql.end();
process.exit(0);
