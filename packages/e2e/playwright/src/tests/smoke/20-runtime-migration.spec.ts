// TEST_OVERVIEW: the runtime migration moves one container Agent onto the vm
// TEST_OVERVIEW: Backend when an operator asks for it, and the Agent keeps what
// TEST_OVERVIEW: it had: its id, its HOME and the Sessions stored there. Only the
// TEST_OVERVIEW: vm lane runs this spec, because its install is the only one with
// TEST_OVERVIEW: both Backends, and the Playwright config runs it there after the
// TEST_OVERVIEW: agent spec, the only one that creates an agent through the UI,
// TEST_OVERVIEW: beside the specs that drive the shared e2e-agent, which create
// TEST_OVERVIEW: none, and one at a time with the other specs that boot their own
// TEST_OVERVIEW: agent. No API makes a container Agent on this install, so it is
// TEST_OVERVIEW: applied as an Agent object the way an operator makes one, and the
// TEST_OVERVIEW: move is asked for the way an operator asks: the request
// TEST_OVERVIEW: annotation, which no page offers. It runs before the
// TEST_OVERVIEW: agent-backend spec, which deletes the VM runner the migrated
// TEST_OVERVIEW: machine runs on. HOME is the only path this spec carries across,
// TEST_OVERVIEW: and the volume it was copied from is checked to be retained after
// TEST_OVERVIEW: the move and deleted with the Agent.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  deleteAgentIfPresent,
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
  applyLegacyContainerAgent,
  expectHomeFile,
  listSessionIds,
  refreshingToken,
  requireBackend,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import {
  agentName as chainAgentName,
  harnessName,
} from "../../lib/fixtures.js";
import { requestRuntimeMigration, retainedVolumes } from "../../lib/cluster.js";
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
  test.setTimeout(300_000);
  api = createRefreshingApiClient(token);
  await requireBackend(api, "vm");
  await acceptTerms(api);
  await deleteAgentIfPresent(api, agentName);
  await applyLegacyContainerAgent(api, agentName, agentName, harnessName);
  agentId = agentName;
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: the Agent to migrate. It is a container Agent that can be migrated, it holds a file in HOME written through the files API, and it holds a Session from one chat turn. The later scenarios check each of these again on the vm Backend. For about a second after the pod turns Ready, the mesh may not route to it yet. A write whose connection was reset may have reached the agent, so the proxy answers it 502 and does not retry it; the write of the same bytes is idempotent, so the helper retries it.
test("a container agent holds a HOME file and a session", async ({ page }) => {
  test.setTimeout(300_000);
  await waitAgentState(api, agentId, "running");
  const agent = await api.agents.get.query({ id: agentId });
  expect(agent.vm, "the agent to migrate starts on the container Backend").toBe(
    false,
  );

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

// TEST_SCENARIO: the operator asks for the move by annotating the Agent, the one trigger there is. The page offers none: the row carries no Migrate control, since a move is not the owner's to start. The request switches nothing at once. The row badges the move with its phase as the controller carries it out, and it is settled once the controller has copied HOME and booted the machine from the copy, the api-server has switched the Backend, and the machine is running. The chain's e2e-agent is a vm Agent in this lane and the restored UI reads the new runtime as the rare case, so its row carries the "New runtime" badge, which renders only once the install answer has arrived — the evidence that the page read its runtime at all.
test("migrates to the vm Backend on an operator's request", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto(baseUrl);
  const chainAgent = (await api.agents.list.query()).find(
    (a) => a.name === chainAgentName,
  );
  expect(
    chainAgent?.vm,
    `the vm lane's UI-created ${chainAgentName} is a vm agent`,
  ).toBe(true);
  await expect(
    agentRow(page, chainAgentName).getByText("New runtime", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const row = agentRow(page, agentName);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(
    row.getByRole("button", { name: "Migrate", exact: true }),
  ).toHaveCount(0);

  requestRuntimeMigration(agentId);
  await expect
    .poll(migrationProgress, {
      timeout: 60_000,
      message: "the operator's request was not taken up",
    })
    .not.toBe("container settled running");
  // UNIT_BOUNDARY_DESCRIPTION: the page asked for nothing, so it waits for the published update rather than for its own write; the reload reads the phase the annotation started even if that update is missed.
  await page.reload();
  await expect(row.getByText(/^Migrating: /)).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(migrationProgress, {
      timeout: 180_000,
      intervals: [5_000],
      message: "the runtime migration did not settle with the machine running",
    })
    .toBe("vm settled running");
});

// TEST_SCENARIO: the migrated Agent is the same Agent. Its id still names it and nothing else took its name, the HOME file reads back as written on the container Backend, every Session it had is still listed, and a new chat turn gets its reply from the machine.
test("keeps its id, HOME and sessions, and chats on the vm Backend", async ({
  page,
}) => {
  test.setTimeout(300_000);
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
