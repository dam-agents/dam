// TEST_OVERVIEW: the runtime migration moves one container Agent onto the vm Backend, at its user's request, and the Agent keeps what it had: its id, its HOME and the Sessions stored there. Only the vm lane runs this spec, because its install is the only one with both Backends, and the Playwright config runs it there after every other spec: it turns the e2e user's vm-sandboxes experiment off and on again, which changes the Backend of any agent the UI creates meanwhile. The UI offers the migration only to a user who opted into the new runtime, so the spec first checks that the Migrate button is absent with the experiment off, then turns it on and migrates through that button. HOME is the only path this spec carries across, and the volume it was copied from is checked to be retained after the move and deleted with the Agent.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  openAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
} from "../../lib/agents.js";
import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  createAgentOn,
  expectHomeFile,
  listSessionIds,
  refreshingToken,
  requireBackend,
  setVmSandboxes,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import {
  agentName as chainAgentName,
  harnessName,
} from "../../lib/fixtures.js";
import { retainedVolumes } from "../../lib/cluster.js";
import { baseUrl } from "../../config.js";

const agentName = "e2e-runtime-migration";
const markerPath = "e2e-migration-marker.txt";
const marker = `home-migrates-${randomUUID()}`;

test.describe.configure({ mode: "serial" });

let api: ApiClient;
const token = refreshingToken();
let agentId = "";
let sessionsBefore: string[] = [];

function agentRow(page: Page, name: string) {
  return page.getByTestId("agent-row").filter({
    has: page.getByRole("heading", { name, exact: true }),
  });
}

async function chatTurn(
  page: Page,
  prompt: string,
  reply: string,
): Promise<void> {
  await setMockAgentReply(api, agentId, reply);
  await openAgentChat(page, agentName, agentId, { cardTimeoutMs: 120_000 });
  await sendMessageToAgent(page, prompt);
  await expect(page.getByText(reply)).toBeVisible({ timeout: 90_000 });
}

async function migrationProgress(): Promise<string> {
  const agent = await api.agents.get.query({ id: agentId });
  const migration = agent.runtimeMigration
    ? `migrating:${agent.runtimeMigration.phase}${agent.runtimeMigration.message ? ` (${agent.runtimeMigration.message})` : ""}`
    : "settled";
  return `${agent.vm ? "vm" : "container"} ${migration} ${agent.state}`;
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  api = createRefreshingApiClient(token);
  await requireBackend(api, "vm");
  await acceptTerms(api);
  await setVmSandboxes(api, false);
  agentId = await createAgentOn(api, "container", agentName, harnessName, {
    neverIdle: true,
  });
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
  await setVmSandboxes(api, true);
});

// TEST_SCENARIO: the Agent to migrate. It is a container Agent that can be migrated, it holds a file in HOME written through the files API, and it holds a Session from one chat turn. The later scenarios check each of these again on the vm Backend.
test("a container agent holds a HOME file and a session", async ({ page }) => {
  test.setTimeout(900_000);
  await waitAgentState(api, agentId, "running");
  const agent = await api.agents.get.query({ id: agentId });
  expect(agent.vm, "the agent to migrate starts on the container Backend").toBe(
    false,
  );
  expect(
    agent.runtimeMigratable,
    "the mock agent persists nothing outside HOME, so it can be migrated",
  ).toBe(true);

  await writeHomeFile(token, agentId, markerPath, marker);
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 60_000,
  });
  await chatTurn(page, "hello-before-migration", "reply-before-migration");
  await expect
    .poll(
      async () => {
        sessionsBefore = await listSessionIds(token, agentId);
        return sessionsBefore.length;
      },
      {
        timeout: 60_000,
        message: "the chat turn left no session on the agent",
      },
    )
    .toBeGreaterThan(0);
});

// TEST_SCENARIO: with the vm-sandboxes experiment off, the UI does not offer the migration. The flags answer must have reached the page, or an absent button proves nothing. The chain's e2e-agent is a vm Agent in this lane, and with the experiment off its row carries the "New runtime" badge, which the UI renders only once that answer has arrived.
test("offers no Migrate button with the experiment off", async ({ page }) => {
  const chainAgent = (await api.agents.list.query()).find(
    (a) => a.name === chainAgentName,
  );
  expect(
    chainAgent?.vm,
    `the vm lane's UI-created ${chainAgentName} is a vm agent`,
  ).toBe(true);

  await page.goto(baseUrl);
  await expect(
    agentRow(page, chainAgentName).getByText("New runtime", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const row = agentRow(page, agentName);
  await expect(row).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Migrate", exact: true }),
  ).toHaveCount(0);
});

// TEST_SCENARIO: the user opts in and migrates through the Migrate button and its confirm dialog. The request switches nothing: the Agent keeps reading as a container Agent with a migration under way, which can still be aborted, while the controller prepares the machine beside it. It is settled once the controller has copied HOME and booted the machine from the copy, the api-server has switched the Backend, the migration's state is cleared, and the machine is running.
test("migrates to the vm Backend from the Migrate button", async ({ page }) => {
  test.setTimeout(1_200_000);
  await setVmSandboxes(api, true);
  await page.goto(baseUrl);
  const row = agentRow(page, agentName);
  await expect(row.getByText("Old runtime", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await row.getByRole("button", { name: "Migrate", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Migrate", exact: true })
    .click();

  await expect
    .poll(
      async () => {
        const agent = await api.agents.get.query({ id: agentId });
        return agent.runtimeMigration
          ? `${agent.vm ? "vm" : "container"}`
          : "none";
      },
      {
        timeout: 30_000,
        message: "the Migrate button did not request a migration",
      },
    )
    .toBe("container");
  await expect
    .poll(migrationProgress, {
      timeout: 900_000,
      intervals: [5_000],
      message: "the runtime migration did not settle with the machine running",
    })
    .toBe("vm settled running");
});

// TEST_SCENARIO: the migrated Agent is the same Agent. Its id still names it and nothing else took its name, the HOME file reads back as written on the container Backend, every Session it had is still listed, and a new chat turn gets its reply from the machine. A second migration is refused, because the Agent already runs on the vm Backend.
test("keeps its id, HOME and sessions, and chats on the vm Backend", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const named = (await api.agents.list.query()).filter(
    (a) => a.name === agentName,
  );
  expect(named.map((a) => a.id)).toEqual([agentId]);
  expect(named[0]?.vm).toBe(true);

  await expectHomeFile(token, agentId, markerPath, marker);
  await expect
    .poll(() => listSessionIds(token, agentId), {
      timeout: 120_000,
      message: "a session from before the migration is missing",
    })
    .toEqual(expect.arrayContaining(sessionsBefore));
  await chatTurn(page, "hello-after-migration", "reply-after-migration");
  await expect(
    api.agents.migrateRuntime.mutate({ id: agentId }),
  ).rejects.toThrow(/already runs on the new runtime/);
});

// TEST_SCENARIO: the volume the copy was read from outlives the move. It is kept for the install's retention window, marked with the agent it was retained for and the path it held, so an operator can still recover the agent's work from before the move. Deleting the agent deletes it, and the volumes are read strictly, so a failed read is never mistaken for none left.
test("retains the old home volume until the agent is deleted", async () => {
  test.setTimeout(300_000);
  const retained = retainedVolumes(agentId);
  expect(retained.map((v) => v.mount)).toEqual(["/home/agent"]);
  expect(Date.parse(retained[0]?.until ?? "")).toBeGreaterThan(Date.now());

  const deleted = agentId;
  await api.agents.delete.mutate({ id: deleted });
  agentId = "";
  await expect
    .poll(
      () => {
        try {
          return retainedVolumes(deleted).length;
        } catch (e) {
          return `the volumes could not be read: ${String(e)}`;
        }
      },
      {
        timeout: 120_000,
        message: "the retained volume outlived its agent",
      },
    )
    .toBe(0);
});
