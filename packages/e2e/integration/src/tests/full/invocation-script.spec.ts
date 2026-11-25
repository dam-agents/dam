import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

import { createApiClient, type ApiClient } from "../../lib/api-client.js";
import { waitForAgentIdRunning } from "../../lib/agents.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

/**
 * TEST_OVERVIEW: A script sub-agent (#4241). A driver spawns a target with a
 * shell command instead of a prompt; the target runs it once with no model
 * turn and leaves its stdout and stderr in the object store. The driver reads
 * the exit code and each stream's size and sha256 from its view, and fetches
 * the exact bytes. A non-zero exit fails the sub-agent with the exit code and
 * the tail of stderr, and its streams stay readable.
 */

interface InvocationView {
  status: "running" | "done" | "failed";
  errorReason?: string;
  exitCode?: number;
  output?: Record<string, { sizeBytes: number; sha256: string }>;
}

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

async function getFromDriver<T>(
  api: ApiClient,
  driverId: string,
  url: string,
): Promise<T> {
  const { status, body } = await api.e2e.performFetch.mutate({
    agentId: driverId,
    url,
  });
  expect(status, `GET ${url} -> ${status}: ${body}`).toBe(200);
  return JSON.parse(body) as T;
}

async function readStream(
  api: ApiClient,
  driverId: string,
  invocationUrl: string,
  stream: "stdout" | "stderr",
): Promise<string> {
  const link = await getFromDriver<{ url: string }>(
    api,
    driverId,
    `${invocationUrl}/output/${stream}`,
  );
  const { status, body } = await api.e2e.performFetch.mutate({
    agentId: driverId,
    url: link.url,
  });
  expect(status).toBe(200);
  return body;
}

async function settled(
  api: ApiClient,
  driverId: string,
  invocationUrl: string,
): Promise<InvocationView> {
  let view: InvocationView = { status: "running" };
  await expect
    .poll(
      async () => {
        view = await getFromDriver<InvocationView>(
          api,
          driverId,
          invocationUrl,
        );
        return view.status;
      },
      { timeout: 300_000, intervals: [3_000] },
    )
    .not.toBe("running");
  return view;
}

test("a script sub-agent returns its exact output (#4241)", async () => {
  test.setTimeout(900_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);

  const driver = await api.agents.create.mutate({
    name: "e2e-script-driver",
    templateId: harnessName,
  });
  await waitForAgentIdRunning(api, driver.id);
  const { value: mcpUrl } = await api.e2e.getEnv.query({
    agentId: driver.id,
    name: "PLATFORM_MCP_URL",
  });
  expect(mcpUrl).toBeTruthy();
  const invocationsUrl = mcpUrl!.replace(/\/mcp$/, "/invocations");

  try {
    await test.step("a script that exits 0 returns stdout byte for byte", async () => {
      const stdout = "first line\n  second line, indented\n\nlast";
      const { id } = await api.e2e.spawnInvocation.mutate({
        agentId: driver.id,
        harness: harnessName,
        script: `printf '%s' '${stdout}'; echo 'a warning' >&2`,
        ttlMs: 20 * 60_000,
      });
      const url = `${invocationsUrl}/${id}`;
      const view = await settled(api, driver.id, url);

      expect(view.status, view.errorReason).toBe("done");
      expect(view.exitCode).toBe(0);
      expect(view.output?.stdout).toEqual({
        sizeBytes: Buffer.byteLength(stdout),
        sha256: sha256(stdout),
      });
      expect(await readStream(api, driver.id, url, "stdout")).toBe(stdout);
      expect(await readStream(api, driver.id, url, "stderr")).toBe(
        "a warning\n",
      );
    });

    await test.step("a script that exits non-zero fails with its exit code and stderr", async () => {
      const { id } = await api.e2e.spawnInvocation.mutate({
        agentId: driver.id,
        harness: harnessName,
        script: "echo partial; echo 'the eval broke' >&2; exit 3",
        ttlMs: 20 * 60_000,
      });
      const url = `${invocationsUrl}/${id}`;
      const view = await settled(api, driver.id, url);

      expect(view.status).toBe("failed");
      expect(view.exitCode).toBe(3);
      expect(view.errorReason).toBe("script exited 3: the eval broke");
      expect(await readStream(api, driver.id, url, "stdout")).toBe("partial\n");
    });
  } finally {
    await api.agents.delete.mutate({ id: driver.id });
  }
});
