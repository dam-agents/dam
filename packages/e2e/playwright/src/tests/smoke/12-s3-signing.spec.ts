import { expect, test } from "@playwright/test";
import { connectionEgressPlaceholder } from "api-server-api";

import { expectAgentEnv, wakeAgent } from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import {
  agentName,
  connectionHost,
  echoUrl,
  s3AccessKeyId,
  s3ConnectionName,
  s3Profile,
  s3Region,
} from "../../lib/fixtures.js";

const amzDate = "20260101T000000Z";
const dummySignature = "0".repeat(64);

function authorization(accessKey: string): string {
  return (
    `AWS4-HMAC-SHA256 Credential=${accessKey}/20260101/${s3Region}/s3/aws4_request, ` +
    `SignedHeaders=host;x-amz-date, Signature=${dummySignature}`
  );
}

async function echoedAuthorization(
  api: ApiClient,
  agentId: string,
  sent: string,
): Promise<string> {
  const { body } = await api.e2e.performFetch.mutate({
    agentId,
    url: echoUrl,
    headers: { authorization: sent, "x-amz-date": amzDate },
  });
  const headers = (JSON.parse(body) as { headers: Record<string, string[]> })
    .headers;
  return headers["Authorization"]?.[0] ?? "";
}

test("S3 Connection re-signs addressed requests and passes foreign ones untouched", async () => {
  test.setTimeout(420_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await wakeAgent(api, agentName);

  let connectionId = "";

  await test.step("create the S3 Connection and grant it to the agent", async () => {
    for (const c of await api.connections.list.query()) {
      if (c.name === s3ConnectionName)
        await api.connections.delete.mutate({ id: c.id });
    }
    const created = await api.connections.create.mutate({
      templateId: "s3-compatible",
      authKind: "sigv4",
      name: s3ConnectionName,
      endpoint: `https://${connectionHost}`,
      region: s3Region,
      accessKeyId: s3AccessKeyId,
      secretAccessKey: "e2e-s3-secret-not-real",
    });
    connectionId = created.id;
    const current = await api.connections.getAgentConnections.query({
      agentId,
    });
    await api.connections.setAgentConnections.mutate({
      agentId,
      connectionIds: [
        ...current.connections.map((c) => c.connectionId),
        connectionId,
      ],
    });
  });

  await test.step("profile: the agent's AWS_PROFILE names the Connection", async () => {
    await expectAgentEnv(
      api,
      agentId,
      "AWS_PROFILE",
      s3Profile,
      "AWS_PROFILE did not converge to the S3 Connection's profile",
    );
  });

  await test.step("addressed: the gateway signs with the real key ID", async () => {
    const sent = authorization(connectionEgressPlaceholder(connectionId));
    await expect
      .poll(
        async () => {
          try {
            return await echoedAuthorization(api, agentId, sent);
          } catch {
            return "";
          }
        },
        {
          timeout: 180_000,
          intervals: [3_000],
          message: "gateway did not re-sign the addressed request",
        },
      )
      .toContain(`Credential=${s3AccessKeyId}/`);
    const signed = await echoedAuthorization(api, agentId, sent);
    expect(signed).not.toContain(dummySignature);
    expect(signed).not.toContain(connectionEgressPlaceholder(connectionId));
  });

  await test.step("foreign: another key ID passes through unchanged", async () => {
    const sent = authorization("AKIAFOREIGN");
    expect(await echoedAuthorization(api, agentId, sent)).toBe(sent);
  });

  await test.step("clean up: delete the Connection", async () => {
    await api.connections.delete.mutate({ id: connectionId });
  });
});
