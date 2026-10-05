// TEST_OVERVIEW: A sigv4 Connection is re-signed at the gateway, and only when the request names it. The agent holds the Connection's placeholder as its access key ID (an AWS profile named after the Connection, AWS_PROFILE pointing at it). A request whose SigV4 Credential carries that placeholder reaches the public echo signed with the real key ID from the Connection's Secret and a fresh signature over an unsigned payload; a request carrying a foreign key ID on the same host arrives byte-for-byte as sent. Rotating the key pair changes the key ID the next request is signed with, without any restart. The e2e api-server accepts any key pair at create and rotation, since the echo is not an S3 endpoint.
import { expect, test } from "@playwright/test";
import {
  AWS_PROFILE_ENV,
  awsProfileSlug,
  connectionEgressPlaceholder,
  S3_COMPATIBLE_TEMPLATE_ID,
} from "api-server-api";

import { expectAgentEnv, wakeAgent } from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName, connectionHost, echoUrl } from "../../lib/fixtures.js";

const s3ConnectionName = "e2e-s3-storage";
const region = "e2e-region-1";
const sentinelKeyId = "AKIAE2ESENTINEL7F3A9C1";
const rotatedKeyId = "AKIAE2EROTATED4B2D8E0";
const foreignKeyId = "AKIAE2EFOREIGN00000000";
const dummySignature = "e2e-dummy-signature";

type EchoedHeaders = Record<string, string>;

function amzDate(): string {
  return new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
}

function sigv4Headers(keyId: string, date: string): Record<string, string> {
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${date.slice(0, 8)}/${region}/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=${dummySignature}`,
    "x-amz-date": date,
  };
}

function signedWith(keyId: string): RegExp {
  return new RegExp(
    `^AWS4-HMAC-SHA256 Credential=${keyId}/\\d{8}/${region}/s3/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$`,
  );
}

async function fetchEchoedHeaders(
  api: ApiClient,
  agentId: string,
  headers: Record<string, string>,
): Promise<EchoedHeaders | undefined> {
  try {
    const { status, body } = await api.e2e.performFetch.mutate({
      agentId,
      url: echoUrl,
      headers,
    });
    if (status !== 200) return undefined;
    const echoed = JSON.parse(body) as { headers?: Record<string, string[]> };
    return Object.fromEntries(
      Object.entries(echoed.headers ?? {}).map(([name, values]) => [
        name.toLowerCase(),
        values.join(", "),
      ]),
    );
  } catch {
    return undefined;
  }
}

async function pollSignedWith(
  api: ApiClient,
  agentId: string,
  placeholder: string,
  keyId: string,
  message: string,
): Promise<EchoedHeaders> {
  let last: EchoedHeaders | undefined;
  await expect
    .poll(
      async () => {
        last = await fetchEchoedHeaders(
          api,
          agentId,
          sigv4Headers(placeholder, amzDate()),
        );
        return last?.authorization ?? "";
      },
      { timeout: 180_000, intervals: [3_000], message },
    )
    .toMatch(signedWith(keyId));
  return last!;
}

test("sigv4 connection: addressed requests are re-signed, foreign ones pass unchanged", async () => {
  test.setTimeout(720_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await wakeAgent(api, agentName);

  let connectionId = "";

  await test.step("create the S3 connection on the echo host and grant it", async () => {
    for (const c of await api.connections.list.query()) {
      if (c.name === s3ConnectionName)
        await api.connections.delete.mutate({ id: c.id });
    }

    ({ id: connectionId } = await api.connections.create.mutate({
      templateId: S3_COMPATIBLE_TEMPLATE_ID,
      authKind: "sigv4",
      name: s3ConnectionName,
      endpoint: `https://${connectionHost}`,
      region,
      accessKeyId: sentinelKeyId,
      secretAccessKey: "e2e-dummy-secret-key-1",
    }));

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

  const placeholder = connectionEgressPlaceholder(connectionId);

  await test.step("profile rail: AWS_PROFILE names the connection", async () => {
    await expectAgentEnv(
      api,
      agentId,
      AWS_PROFILE_ENV,
      awsProfileSlug(s3ConnectionName),
      `env ${AWS_PROFILE_ENV} did not converge to the connection's profile`,
    );
  });

  await test.step("addressed: the echo sees the real key ID and a fresh signature", async () => {
    const signed = await pollSignedWith(
      api,
      agentId,
      placeholder,
      sentinelKeyId,
      "echo endpoint did not return a request signed with the sentinel key ID",
    );
    expect(signed.authorization).not.toContain(placeholder);
    expect(signed.authorization).not.toContain(dummySignature);
    expect(signed["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
  });

  await test.step("foreign: a request naming another key ID passes unchanged", async () => {
    const sent = sigv4Headers(foreignKeyId, amzDate());
    let last: EchoedHeaders | undefined;
    await expect
      .poll(
        async () => {
          last = await fetchEchoedHeaders(api, agentId, sent);
          return last?.authorization ?? "";
        },
        {
          timeout: 60_000,
          intervals: [3_000],
          message: "echo endpoint did not return the foreign request",
        },
      )
      .toBe(sent.authorization);
    expect(last!["x-amz-date"]).toBe(sent["x-amz-date"]);
    expect(last!["x-amz-content-sha256"]).toBeUndefined();
  });

  await test.step("rotation: the next request is signed with the new key ID", async () => {
    await api.connections.update.mutate({
      id: connectionId,
      accessKeyId: rotatedKeyId,
      secretAccessKey: "e2e-dummy-secret-key-2",
    });
    await pollSignedWith(
      api,
      agentId,
      placeholder,
      rotatedKeyId,
      "echo endpoint did not return a request signed with the rotated key ID",
    );
  });

  await test.step("clean up the S3 connection", async () => {
    await api.connections.delete.mutate({ id: connectionId });
  });
});
