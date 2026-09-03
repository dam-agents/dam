import { request as httpRequest } from "node:http";

import { expect, test } from "@playwright/test";

import { createApiClient, createWsApiClient } from "../../lib/api-client.js";
import { waitForAgentRunning } from "../../lib/agents.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { baseUrl } from "../../config.js";
import { harnessName } from "../../lib/fixtures.js";

/**
 * TEST_OVERVIEW: Knowledge-base sharing end to end against a real cluster: an
 * owner shares a KB, the platform publishes a read-only snapshot to object
 * storage, and the share host serves it as a stateless MCP endpoint gated by
 * the per-share token header. Verifies publish reaching idle with the seeded
 * document, an MCP initialize/list/read round-trip returning the seeded
 * content, rotate locking out the old secret, and the consumer connection
 * create verifying the share string server-side.
 */

const KB_NAME = "e2e-kb-share";
const SENTINEL = "kb-share-sentinel-1739";
const MCP_PROTOCOL = "2025-03-26";

const shareHost = `share.${new URL(baseUrl).hostname}`;

async function agentFilesMutation(
  token: string,
  agentId: string,
  procedure: string,
  input: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/api/agents/${agentId}/trpc/files.${procedure}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

const target = new URL(baseUrl);

interface McpResponse {
  status: number;
  text: string;
}

async function mcpRequest(
  headers: Record<string, string>,
  body: unknown,
): Promise<McpResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: "/mcp/kb",
        method: "POST",
        headers: {
          host: shareHost,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: data }),
        );
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function initializeMessage() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL,
      capabilities: {},
      clientInfo: { name: "e2e", version: "1.0" },
    },
  };
}

async function callTool(
  tokenHeader: Record<string, string>,
  name: string,
  args: unknown,
): Promise<string> {
  const res = await mcpRequest(
    { ...tokenHeader, "mcp-protocol-version": MCP_PROTOCOL },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
  );
  expect(res.status).toBe(200);
  const raw = res.text;
  const lines = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map(
      (line) => JSON.parse(line.slice(5)) as { id?: number; result?: unknown },
    );
  const messages = lines.length
    ? lines
    : [JSON.parse(raw) as { id?: number; result?: unknown }];
  const reply = messages.find((m) => m.id === 2);
  const result = reply?.result as
    | { content: { text: string }[]; isError?: boolean }
    | undefined;
  expect(result, raw).toBeDefined();
  expect(result!.isError ?? false, raw).toBe(false);
  return result!.content.map((c) => c.text).join("\n");
}

test("share a knowledge base and read it over the share-host MCP endpoint", async () => {
  test.setTimeout(360_000);
  const token = await getAccessToken();
  const httpApi = createApiClient(token);
  await acceptTerms(httpApi);
  const { api, close } = createWsApiClient(token);

  try {
    let agentId = "";
    await test.step("create the knowledge base and seed its wiki", async () => {
      await api.knowledgeBases.create.mutate({
        name: KB_NAME,
        templateId: harnessName,
        kbTemplateId: "plain-wiki",
      });
      agentId = await waitForAgentRunning(httpApi, KB_NAME);
      await agentFilesMutation(token, agentId, "mkdir", { path: "work/wiki" });
      const write = await agentFilesMutation(token, agentId, "write", {
        path: "work/wiki/index.md",
        content: `# Team wiki\n\nThe magic word is ${SENTINEL}.\n`,
      });
      expect(write.status, await write.text()).toBe(200);
    });

    let shareId = "";
    let secret = "";
    await test.step("share and wait for the publish to land", async () => {
      await api.kbShares.create.mutate({ agentId, roots: ["wiki"] });
      await expect
        .poll(
          async () => {
            const status = await api.kbShares.status.query({ agentId });
            return status?.publishState === "idle" &&
              (status.documentCount ?? 0) >= 1
              ? "published"
              : (status?.publishError ?? status?.publishState ?? "missing");
          },
          { timeout: 120_000, intervals: [2_000] },
        )
        .toBe("published");
      const { shareString } = await api.kbShares.reveal.mutate({ agentId });
      const match = /^kbshare_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/.exec(
        shareString,
      );
      expect(match, shareString).not.toBeNull();
      shareId = match![1]!;
      secret = match![2]!;
    });

    const tokenHeader = () => ({ [`x-kb-token-${shareId}`]: secret });

    await test.step("MCP round-trip serves the seeded content", async () => {
      const noToken = await mcpRequest({}, initializeMessage());
      expect(noToken.status).toBe(401);

      const init = await mcpRequest(tokenHeader(), initializeMessage());
      expect(init.status, init.text).toBe(200);

      const listed = await callTool(tokenHeader(), "list_knowledge_bases", {});
      expect(listed).toContain(shareId);
      expect(listed).toContain(KB_NAME);

      const read = await callTool(tokenHeader(), "read_document", {
        kb: shareId,
        path: "wiki/index.md",
      });
      expect(read).toContain(SENTINEL);

      const searched = await callTool(tokenHeader(), "search_knowledge", {
        kb: shareId,
        query: SENTINEL,
      });
      expect(searched).toContain("wiki/index.md");
    });

    await test.step("rotate locks out the old secret", async () => {
      const { shareString } = await api.kbShares.rotate.mutate({ agentId });
      const rotated = /^kbshare_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/.exec(
        shareString,
      )!;
      expect(rotated[1]).toBe(shareId);

      const stale = await mcpRequest(tokenHeader(), initializeMessage());
      expect(stale.status).toBe(401);
      secret = rotated[2]!;
      const fresh = await mcpRequest(tokenHeader(), initializeMessage());
      expect(fresh.status).toBe(200);
    });

    await test.step("consumer connection verifies the share string", async () => {
      await expect(
        api.connections.create.mutate({
          templateId: "shared-knowledge-base",
          name: "e2e-kb-consumer-bad",
          authKind: "header",
          value: `kbshare_${shareId}_${"A".repeat(43)}`,
        }),
      ).rejects.toThrow(/unknown or revoked/);

      const { shareString } = await api.kbShares.reveal.mutate({ agentId });
      const { id } = await api.connections.create.mutate({
        templateId: "shared-knowledge-base",
        name: "e2e-kb-consumer",
        authKind: "header",
        value: shareString,
      });
      const listed = await api.connections.list.query();
      expect(listed.some((c) => c.id === id)).toBe(true);
      await api.connections.delete.mutate({ id });
    });

    await test.step("unshare kills the endpoint", async () => {
      await api.kbShares.revoke.mutate({ agentId });
      const denied = await mcpRequest(tokenHeader(), initializeMessage());
      expect(denied.status).toBe(401);
      await api.agents.delete.mutate({ id: agentId });
    });
  } finally {
    close();
  }
});
