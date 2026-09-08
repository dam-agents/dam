/**
 * TEST_OVERVIEW: Image-skill lifecycle (#3460). A Local Skill whose bytes match
 * a version the platform ever shipped (the Shipped-Skill Manifest baked into
 * every image) is platform-managed: removed once the image stops shipping the
 * name, pulled to the current version when the image ships a newer one. Bytes
 * that match nothing shipped are the user's and are never touched, and a
 * user's deletion of an image skill is final. The spec plants historical
 * shipped bytes recovered from git — the same source the manifest backfill
 * hashed — through the product's own createLocal API, forces runtime-channel
 * snapshots via user env updates, and asserts the reconciled skills.state.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import { waitForAgentRunning } from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const agentName = "e2e-skill-lifecycle";

const retiredSkill = "websearch";
const retiredRev = "538ffa0057bf";
const retiredFile =
  "packages/agents/claude-code/workspace/.agents/skills/websearch/SKILL.md";

const shippedSkill = "platform-schedules";
const shippedOldRev = "1c6470c46e71";
const shippedFile = "packages/platform-base/skills/platform-schedules/SKILL.md";

const tickEnv = "E2E_RECONCILE_TICK";
const reconcileGraceMs = 8_000;

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

function shippedBytesAt(rev: string, file: string): string {
  return execFileSync("git", ["show", `${rev}:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

async function standaloneNames(
  api: ApiClient,
  agentId: string,
): Promise<string[]> {
  const state = await api.skills.state.query({ agentId });
  return state.standalone.map((s) => s.name);
}

let tickSeq = 0;
async function forceSnapshot(api: ApiClient, agentId: string): Promise<void> {
  const value = `tick-${++tickSeq}`;
  const env = ((await api.agents.get.query({ id: agentId })).env ?? []).filter(
    (e) => e.name !== tickEnv,
  );
  await api.agents.update.mutate({
    id: agentId,
    env: [...env, { name: tickEnv, value }],
  });
  await expect
    .poll(
      async () =>
        (await api.e2e.getEnv.query({ agentId, name: tickEnv })).value,
      {
        timeout: 120_000,
        intervals: [2_000],
        message: "env snapshot never reached the agent",
      },
    )
    .toBe(value);
}

/**
 * TEST_SCENARIO: An agent volume holds copies of image skills across the three
 * drifts an image change causes — a retired skill's untouched copy, a shipped
 * skill downgraded to an older shipped version, a user deletion of an image
 * skill — plus a user skill squatting a retired name. Reconciliation must
 * remove the first, update the second to the shipped version, leave the
 * deletion alone, and never touch the diverged copy.
 */
test("image skills are platform-managed while untouched (#3460)", async () => {
  test.setTimeout(900_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);

  const retiredBytes = shippedBytesAt(retiredRev, retiredFile);
  const oldShippedBytes = shippedBytesAt(shippedOldRev, shippedFile);
  const currentShippedBytes = readFileSync(join(repoRoot, shippedFile), "utf8");
  expect(oldShippedBytes).not.toBe(currentShippedBytes);

  let agentId = "";
  try {
    await test.step("create an agent and wait for the image seed", async () => {
      const created = await api.agents.create.mutate({
        name: agentName,
        templateId: harnessName,
      });
      agentId = created.id;
      await waitForAgentRunning(api, agentName);
      await expect
        .poll(() => standaloneNames(api, agentId), {
          timeout: 120_000,
          intervals: [2_000],
          message: `image skill ${shippedSkill} never seeded`,
        })
        .toContain(shippedSkill);
    });

    await test.step("an untouched copy of a retired skill is reaped", async () => {
      await api.skills.createLocal.mutate({
        agentId,
        skills: [{ name: retiredSkill, content: retiredBytes }],
      });
      expect(await standaloneNames(api, agentId)).toContain(retiredSkill);
      await forceSnapshot(api, agentId);
      await expect
        .poll(() => standaloneNames(api, agentId), {
          timeout: 60_000,
          intervals: [2_000],
          message: `retired skill ${retiredSkill} was not reaped`,
        })
        .not.toContain(retiredSkill);
    });

    await test.step("a diverged copy under a retired name survives", async () => {
      await api.skills.createLocal.mutate({
        agentId,
        skills: [
          {
            name: retiredSkill,
            content: `---\nname: ${retiredSkill}\ndescription: the user's own replacement\n---\nUser bytes, not the platform's.\n`,
          },
        ],
      });
      await forceSnapshot(api, agentId);
      await new Promise((r) => setTimeout(r, reconcileGraceMs));
      expect(await standaloneNames(api, agentId)).toContain(retiredSkill);
    });

    await test.step("a user's deletion of an image skill is final", async () => {
      await api.skills.deleteLocal.mutate({ agentId, name: shippedSkill });
      expect(await standaloneNames(api, agentId)).not.toContain(shippedSkill);
      await forceSnapshot(api, agentId);
      await new Promise((r) => setTimeout(r, reconcileGraceMs));
      expect(await standaloneNames(api, agentId)).not.toContain(shippedSkill);
    });

    await test.step("an older shipped version is pulled to the current one", async () => {
      await api.skills.createLocal.mutate({
        agentId,
        skills: [{ name: shippedSkill, content: oldShippedBytes }],
      });
      await forceSnapshot(api, agentId);
      await expect
        .poll(
          async () => {
            const read = await api.skills.readLocal.query({
              agentId,
              name: shippedSkill,
            });
            return (
              read.files.find((f) => f.relPath === "SKILL.md")?.content ?? ""
            );
          },
          {
            timeout: 60_000,
            intervals: [2_000],
            message: `${shippedSkill} was not updated to the shipped version`,
          },
        )
        .toBe(currentShippedBytes);
    });
  } finally {
    if (agentId) await api.agents.delete.mutate({ id: agentId });
  }
});
