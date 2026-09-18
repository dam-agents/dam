import { expect, test } from "@playwright/test";

import { createApiClient, type ApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { ensureAgentExists, waitForAgentRunning } from "../../lib/agents.js";
import { harnessName } from "../../lib/fixtures.js";

/**
 * TEST_OVERVIEW: Satellites against a real cluster, driven from the worker's
 * side — the test process plays the machine outside the platform. Covers the
 * half that unit tests cannot reach: real auth and scopes, the manifest landing
 * in Postgres as a parsed snapshot, grants moving an agent in and out of a
 * satellite's reach, draining, and removal. A command pattern the grammar
 * rejects must be refused at connect rather than stored half-valid, because a
 * stored-but-unparseable manifest would fail every later start instead of the
 * one bad line.
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
  commands: [
    { run: "/bin/echo (hello|goodbye)", about: "Say something" },
    { run: "/bin/sleep ^[1-9]$", approval: "always" as const },
  ],
};

async function removeIfPresent(api: ApiClient): Promise<void> {
  const existing = await api.satellites.list.query();
  if (existing.some((s) => s.name === SATELLITE))
    await api.satellites.remove.mutate(SATELLITE);
}

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
    expect(satellite?.commands.map((c) => c.run)).toEqual(
      MANIFEST.commands.map((c) => c.run),
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

  test("a manifest the grammar rejects is refused rather than stored", async () => {
    const token = await getAccessToken();
    const api = createApiClient(token);
    await acceptTerms(api);

    await expect(
      api.satellites.connect.mutate({
        manifest: {
          ...MANIFEST,
          name: `${SATELLITE}-bad`,
          commands: [{ run: "*" }],
        },
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
