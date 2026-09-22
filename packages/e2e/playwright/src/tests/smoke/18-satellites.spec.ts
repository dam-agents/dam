import { expect, test } from "@playwright/test";

import { createApiClient, type ApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { ensureAgentExists, waitForAgentRunning } from "../../lib/agents.js";
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
 * Deliberately not covered here: an agent actually starting a job. That path
 * runs through the platform MCP server on the in-cluster harness port, which no
 * test-host client can reach, and the scripted mock agent replays session
 * updates rather than calling tools. Admission, matching and the job lifecycle
 * are covered by unit tests instead.
 */

const SATELLITE = "e2e-satellite";
const AGENT_NAME = "e2e-satellite-agent";

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

test.describe("satellites", () => {
  /**
   * TEST_SCENARIO: The whole worker-side lifecycle against a real cluster. The
   * agent it brings up is deleted at the end: left running it is an extra
   * StatefulSet competing for a small cluster's CPU for the rest of the suite,
   * and the specs that need an agent to answer are the ones that pay for it.
   */
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

    await api.agents.delete.mutate({ id: agentId }).catch(() => {});
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
});
