import { expect, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import { createApiClient, type ApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import {
  deleteAgentIfPresent,
  ensureAgentExists,
  waitForAgentRunning,
} from "../../lib/agents.js";
import { harnessName } from "../../lib/fixtures.js";

/**
 * TEST_OVERVIEW: Satellites against a real cluster, driven from the worker's
 * side — the test process plays the machine outside the platform. Covers the
 * half that unit tests cannot reach: real auth and scopes, the snapshot landing
 * in Postgres as a parsed snapshot, grants moving an agent in and out of a
 * satellite's reach, draining, and removal. A snapshot the contract rejects must
 * be refused at connect rather than stored half-valid, because a stored-but-
 * invalid tool list would fail every later start instead of the one bad tool.
 *
 * The browser half checks the one path a user has to a satellite in the UI: it
 * appears among Connections only once a machine has connected, and it is added
 * to an agent from that agent's connection catalogue.
 *
 * Deliberately not covered here: an agent actually starting a job. That path
 * runs through the platform MCP server on the in-cluster harness port, which no
 * test-host client can reach, and the scripted mock agent replays session
 * updates rather than calling tools. Admission, matching and the job lifecycle
 * are covered by unit tests instead.
 */

const SATELLITE = "e2e-satellite";
const AGENT_NAME = "e2e-satellite-agent";
const CREATED_AGENT_NAME = "e2e-satellite-created";

const MANIFEST = {
  name: SATELLITE,
  description: "e2e satellite",
  maxConcurrent: 4,
  tools: [
    {
      name: "run",
      title: "Run an approved command",
      description: "/bin/echo (hello|goodbye)",
      inputSchema: {
        type: "object",
        properties: { cmd: { type: "array", items: { type: "string" } } },
        required: ["cmd"],
      },
    },
  ],
};

async function removeIfPresent(api: ApiClient): Promise<void> {
  const existing = await api.satellites.list.query();
  if (existing.some((s) => s.name === SATELLITE))
    await api.satellites.remove.mutate(SATELLITE);
}

/**
 * TEST_SCENARIO: The agent this suite brings up is taken down however the run
 * ends. Left behind it is an extra StatefulSet competing for a small cluster's
 * CPU for the rest of the suite, and the specs that need an agent to answer are
 * the ones that pay — so the cleanup cannot sit on the passing path, where a
 * failed assertion skips it. It looks the agent up by name rather than by an id
 * the test captured, because an agent that was created and never came up is
 * exactly the one a failed wait would otherwise leave behind.
 */
test.afterAll(async () => {
  const api = createApiClient(await getAccessToken());
  const agents = await api.agents.list.query().catch(() => []);
  for (const found of agents.filter((a) =>
    [AGENT_NAME, CREATED_AGENT_NAME].includes(a.name),
  ))
    await api.agents.delete.mutate({ id: found.id }).catch(() => {});
});

test.describe("satellites", () => {
  test("a machine registers, is granted to an agent, drains and is removed", async () => {
    const token = await getAccessToken();
    const api = createApiClient(token);
    await acceptTerms(api);
    await removeIfPresent(api);

    await api.satellites.connect.mutate({
      manifest: MANIFEST,
      host: "e2e-host",
    });

    const listed = await api.satellites.list.query();
    const satellite = listed.find((s) => s.name === SATELLITE);
    expect(
      satellite,
      "the satellite should be listed after connecting",
    ).toBeDefined();
    expect(satellite?.online).toBe(true);
    expect(satellite?.host).toBe("e2e-host");
    expect(satellite?.tools.map((t) => t.name)).toEqual(
      MANIFEST.tools.map((t) => t.name),
    );
    expect(satellite?.grantedAgentIds).toEqual([]);

    await ensureAgentExists(api, AGENT_NAME, harnessName);
    const agentId = await waitForAgentRunning(api, AGENT_NAME);

    await api.satellites.grant.mutate({ satellite: SATELLITE, agentId });
    expect(
      (await api.satellites.list.query()).find((s) => s.name === SATELLITE)
        ?.grantedAgentIds,
    ).toContain(agentId);

    await api.satellites.revoke.mutate({ satellite: SATELLITE, agentId });
    expect(
      (await api.satellites.list.query()).find((s) => s.name === SATELLITE)
        ?.grantedAgentIds,
    ).not.toContain(agentId);

    const claimed = await api.satellites.claim.mutate({
      satellite: SATELLITE,
      capacity: 4,
      waitMs: 0,
    });
    expect(claimed).toEqual([]);

    await api.satellites.drain.mutate(SATELLITE);
    expect(
      (await api.satellites.list.query()).find((s) => s.name === SATELLITE)
        ?.draining,
    ).toBe(true);

    await api.satellites.remove.mutate(SATELLITE);
    expect(
      (await api.satellites.list.query()).some((s) => s.name === SATELLITE),
    ).toBe(false);
  });

  test("a snapshot the contract rejects is refused rather than stored", async () => {
    const token = await getAccessToken();
    const api = createApiClient(token);
    await acceptTerms(api);

    await expect(
      api.satellites.connect.mutate({
        manifest: { ...MANIFEST, name: `${SATELLITE}-bad`, tools: [] },
      }),
    ).rejects.toThrow();

    expect(
      (await api.satellites.list.query()).some(
        (s) => s.name === `${SATELLITE}-bad`,
      ),
    ).toBe(false);
  });

  test("jobs are readable for a satellite that has run none", async () => {
    const token = await getAccessToken();
    const api = createApiClient(token);
    await acceptTerms(api);
    await removeIfPresent(api);

    await api.satellites.connect.mutate({ manifest: MANIFEST });
    expect(await api.satellites.jobs.query(SATELLITE)).toEqual([]);
    await api.satellites.remove.mutate(SATELLITE);
  });

  /**
   * TEST_SCENARIO: Satellites are experimental in the CLI, and a second switch
   * in the UI would be one more place to turn them on. So the UI shows them
   * only once a machine has connected: before that, Connections carries no
   * satellite surface at all; after, the satellite is listed there and in an
   * agent's catalogue, and adding it there grants it.
   */
  test("a connected satellite shows among Connections and is added to an agent there", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const api = createApiClient(await getAccessToken());
    await acceptTerms(api);
    await removeIfPresent(api);

    await page.goto(`${baseUrl}/settings/connections`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Connections" }),
    ).toBeVisible();
    await expect(page.getByTestId(`satellite-${SATELLITE}`)).toHaveCount(0);

    await api.satellites.connect.mutate({
      manifest: MANIFEST,
      host: "e2e-host",
    });
    await page.reload();
    const row = page
      .getByTestId("connection-group-satellites")
      .getByTestId(`satellite-${SATELLITE}`);
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(/Offline|Shutting down/);

    await ensureAgentExists(api, AGENT_NAME, harnessName);
    const agentId = await waitForAgentRunning(api, AGENT_NAME);
    await page.goto(`${baseUrl}/sandboxes/${agentId}/connections`);
    await page.getByTestId("open-connection-catalog").first().click();
    await page.getByTestId("catalog-tab-mcp").click();
    await page.getByTestId(`catalog-add-satellite-${SATELLITE}`).click();
    await expect(page.getByText("In this agent")).toBeVisible();

    await expect
      .poll(async () =>
        (await api.satellites.list.query())
          .find((s) => s.name === SATELLITE)
          ?.grantedAgentIds.includes(agentId),
      )
      .toBe(true);

    await api.satellites.remove.mutate(SATELLITE);
  });

  /**
   * TEST_SCENARIO: A satellite is per user, so nothing stops it being picked
   * before the agent exists. The new-agent form offers the same catalogue tab;
   * the pick is held in the draft and granted once the agent is created,
   * because a grant needs an agent id.
   *
   * This is the second agent the suite brings up, and the earlier tests' agent
   * is still running when it starts. On the single-node CI cluster the two do
   * not fit at once, so the agent that is finished with is taken down first,
   * and the wait still allows for a start that queues behind its removal.
   */
  test("a satellite picked on the new-agent form is granted once the agent exists", async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const api = createApiClient(await getAccessToken());
    await acceptTerms(api);
    await removeIfPresent(api);
    await deleteAgentIfPresent(api, AGENT_NAME);
    await api.satellites.connect.mutate({
      manifest: MANIFEST,
      host: "e2e-host",
    });

    await page.goto(`${baseUrl}/agents/new`);
    await page.getByTestId(`template-card-${harnessName}`).click();
    await page.getByPlaceholder("my-agent").fill(CREATED_AGENT_NAME);

    await page.getByTestId("provider-select").click();
    await page.getByTestId("provider-option-openai").click();
    const dialog = page.getByRole("dialog");
    if (
      await dialog.waitFor({ timeout: 2_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await dialog.locator('input[type="password"]').fill("sk-e2e-dummy-key");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toBeHidden();
    }

    await page.getByTestId("open-connection-catalog").first().click();
    await page.getByTestId("catalog-tab-mcp").click();
    await page.getByTestId(`catalog-add-satellite-${SATELLITE}`).click();
    await page.getByTestId("catalog-close").click();
    await expect(page.getByTestId(`satellite-${SATELLITE}`)).toBeVisible();
    await page.getByRole("button", { name: /create coding agent/i }).click();

    const agentId = await waitForAgentRunning(api, CREATED_AGENT_NAME, {
      timeoutMs: 360_000,
    });
    expect(
      (await api.satellites.list.query()).find((s) => s.name === SATELLITE)
        ?.grantedAgentIds,
    ).toContain(agentId);

    await api.satellites.remove.mutate(SATELLITE);
  });
});
