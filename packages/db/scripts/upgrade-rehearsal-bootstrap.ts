import assert from "node:assert/strict";
import { reconcileControlGrants } from "../../api-server/src/modules/agent-store/infrastructure/control-grants.js";
import { reconcileUsageViewGrants } from "../../api-server/src/modules/usage/infrastructure/usage-view-grants.js";
import { createDb } from "../src/client.js";

const url = process.argv[2];
if (!url) {
  console.error("usage: upgrade-rehearsal-bootstrap.ts <url>");
  process.exit(2);
}
const { db, sql } = createDb(url);
try {
  const control = await reconcileControlGrants(db);
  const usage = await reconcileUsageViewGrants(db);
  assert.equal(control.rolePresent, true);
  assert.equal(control.skipped, false);
  assert.equal(control.failed, undefined);
  assert.deepEqual(control.missing, []);
  assert.equal(usage.rolePresent, true);
  assert.equal(usage.failed, undefined);
  assert.deepEqual(usage.unreadable, []);
  assert.deepEqual(usage.notGrantable, []);
  const user = (await sql<{ user: string }[]>`SELECT current_user AS user`)[0]
    ?.user;
  console.log(
    `ok: grant reconcilers as ${user}: ${control.granted.length} control grants, ${usage.readable.length} usage views`,
  );
} finally {
  await sql.end();
}
