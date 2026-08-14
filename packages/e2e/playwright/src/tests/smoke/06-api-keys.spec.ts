import { expect, test } from "@playwright/test";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter, Scope } from "api-server-api";

import { waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient, type ApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";

const KEY_PREFIX = "e2e-authz";
const mintedKeyIds: string[] = [];
const createdAgentIds: string[] = [];
let jwt: ApiClient;

async function mintKey(
  scopes: Scope[],
  agentIds: string[] | "*" = "*",
): Promise<ApiClient> {
  const { key, plaintext } = await jwt.apiKeys.create.mutate({
    name: `${KEY_PREFIX}-${scopes.join("+")}-${mintedKeyIds.length}`,
    scopes,
    agentIds,
  });
  mintedKeyIds.push(key.id);
  return createApiClient(plaintext);
}

function trpcCode(err: unknown): string | undefined {
  return err instanceof TRPCClientError
    ? (err as TRPCClientError<AppRouter>).data?.code
    : undefined;
}

async function expectRejected(
  call: Promise<unknown>,
  code: string,
  label: string,
): Promise<void> {
  try {
    await call;
  } catch (err) {
    expect(trpcCode(err), `${label}: unexpected error ${String(err)}`).toBe(
      code,
    );
    return;
  }
  throw new Error(`${label}: expected ${code} but the call resolved`);
}

test.beforeAll(async () => {
  jwt = createApiClient(await getAccessToken());
});

test.afterAll(async () => {
  for (const id of createdAgentIds) {
    await jwt.agents.delete.mutate({ id }).catch(() => {});
  }
  for (const id of mintedKeyIds) {
    await jwt.apiKeys.revoke.mutate({ id }).catch(() => {});
  }
});

test("agent lifecycle across scoped keys — manage owns CRUD, operate runs it, read only looks", async () => {
  test.setTimeout(240_000);

  const manage = await mintKey(["agents:manage"]);
  const operate = await mintKey(["agents:operate"]);
  const read = await mintKey(["agents:read"]);

  const templates = await manage.templates.list.query();
  const template = templates.find((t) => t.name === "mock") ?? templates[0];
  if (!template) throw new Error("no agent template available in the cluster");

  const name = `e2e-authz-crud-${Date.now()}`;
  const createInput = { name, templateId: template.id };

  await expectRejected(
    read.agents.create.mutate(createInput),
    "FORBIDDEN",
    "agents:read → agents.create",
  );
  await expectRejected(
    operate.agents.create.mutate(createInput),
    "FORBIDDEN",
    "agents:operate → agents.create",
  );
  const created = await manage.agents.create.mutate(createInput);
  createdAgentIds.push(created.id);
  expect(created.name).toBe(name);

  const agentId = await waitForAgentRunning(manage, name);
  expect((await read.agents.get.query({ id: agentId })).name).toBe(name);
  expect((await operate.agents.get.query({ id: agentId })).state).toBe(
    "running",
  );

  const uploaded = await operate.files.upload.mutate({
    agentId,
    path: "e2e-authz.txt",
    contentBase64: Buffer.from("hello from the e2e authz test").toString(
      "base64",
    ),
  });
  expect(uploaded.mtimeMs).toBeGreaterThan(0);
  await expectRejected(
    read.files.upload.mutate({
      agentId,
      path: "nope.txt",
      contentBase64: Buffer.from("x").toString("base64"),
    }),
    "FORBIDDEN",
    "agents:read → files.upload (operate)",
  );

  const description = "updated by the e2e authz test";
  await expectRejected(
    operate.agents.update.mutate({ id: agentId, description }),
    "FORBIDDEN",
    "agents:operate → agents.update",
  );
  await manage.agents.update.mutate({ id: agentId, description });
  expect((await read.agents.get.query({ id: agentId })).description).toBe(
    description,
  );

  await expectRejected(
    operate.agents.delete.mutate({ id: agentId }),
    "FORBIDDEN",
    "agents:operate → agents.delete",
  );
  await expectRejected(
    read.agents.delete.mutate({ id: agentId }),
    "FORBIDDEN",
    "agents:read → agents.delete",
  );
  await manage.agents.delete.mutate({ id: agentId });

  await expect
    .poll(
      async () =>
        (await manage.agents.list.query()).some((a) => a.id === agentId),
      { timeout: 30_000, message: `agent ${agentId} not removed after delete` },
    )
    .toBe(false);
});

test("credentials:read — credential reads allowed; agent reads + writes forbidden", async () => {
  const cred = await mintKey(["credentials:read"]);

  expect(Array.isArray(await cred.connections.list.query())).toBe(true);

  await expectRejected(
    cred.agents.list.query(),
    "FORBIDDEN",
    "credentials:read → agents.list (needs an agent scope)",
  );
  await expectRejected(
    cred.connections.delete.mutate({ id: "does-not-exist" }),
    "FORBIDDEN",
    "credentials:read → connections.delete (credentials:manage)",
  );
});

test("API keys cannot manage API keys (browserOnly)", async () => {
  const key = await mintKey(["agents:read"]);
  await expectRejected(
    key.apiKeys.list.query(),
    "FORBIDDEN",
    "api-key → apiKeys.list",
  );
});

test("agents:manage keys must be wildcard-bound (mint rejects an agent-bound manage key)", async () => {
  await expectRejected(
    jwt.apiKeys.create.mutate({
      name: `${KEY_PREFIX}-bound-manage`,
      scopes: ["agents:manage"],
      agentIds: ["some-agent"],
    }),
    "BAD_REQUEST",
    "mint agents:manage + specific binding",
  );
});
