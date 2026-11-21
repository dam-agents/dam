import { request } from "node:http";

import { expect } from "@playwright/test";

import { baseUrl } from "./config.js";
import type { Person } from "./people.js";

const mcpProtocol = "2025-03-26";
const target = new URL(baseUrl);
const shareHost = `share.${target.hostname}`;

/** UNIT_BOUNDARY_DESCRIPTION: a share string split into the share it names and the secret that opens it. */
export function partsOf(shareString: string): {
  shareId: string;
  secret: string;
} {
  const match = /^kbshare_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/.exec(
    shareString,
  );
  if (match === null) throw new Error(`"${shareString}" is no share string`);
  return { shareId: match[1]!, secret: match[2]! };
}

/** UNIT_BOUNDARY_DESCRIPTION: one write to an agent's workspace through its files API, as the web UI's file browser sends it; a 502 while the agent wakes is retried. */
export async function agentFiles(
  person: Person,
  agentId: string,
  procedure: "mkdir" | "write" | "remove",
  input: object,
): Promise<number> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const res = await fetch(
      `${baseUrl}/api/agents/${encodeURIComponent(agentId)}/trpc/files.${procedure}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await person.token()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
    if (res.status !== 502 || Date.now() > deadline) return res.status;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/** UNIT_BOUNDARY_DESCRIPTION: puts a page with its text in a knowledge base's workspace, making its folder first. */
export async function writePage(
  person: Person,
  agentId: string,
  path: string,
  text: string,
): Promise<void> {
  const folder = path.split("/").slice(0, -1).join("/");
  await agentFiles(person, agentId, "mkdir", { path: `work/${folder}` });
  expect(
    await agentFiles(person, agentId, "write", {
      path: `work/${path}`,
      content: text,
    }),
    `${path} was not written`,
  ).toBe(200);
}

function mcpPost(
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: "/mcp/kb",
        method: "POST",
        headers: {
          host: shareHost,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": mcpProtocol,
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

function tokenHeader(shareString: string): Record<string, string> {
  const { shareId, secret } = partsOf(shareString);
  return { [`x-kb-token-${shareId}`]: secret };
}

/** UNIT_BOUNDARY_DESCRIPTION: whether the share host opens an MCP session to whoever holds the share string, as a person's MCP client does. */
export async function opens(shareString: string): Promise<boolean> {
  const res = await mcpPost(tokenHeader(shareString), {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: mcpProtocol,
      capabilities: {},
      clientInfo: { name: "acceptance", version: "1.0" },
    },
  });
  return res.status === 200;
}

/** UNIT_BOUNDARY_DESCRIPTION: one tool of the share host's MCP endpoint, called with a share string: the text of its answer. */
export async function callShareTool(
  shareString: string,
  name: "read_document" | "list_documents" | "search_knowledge",
  args: Record<string, string>,
): Promise<string> {
  const { shareId } = partsOf(shareString);
  const res = await mcpPost(tokenHeader(shareString), {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: { kb: shareId, ...args } },
  });
  expect(res.status, res.text).toBe(200);
  const messages = res.text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map(
      (line) => JSON.parse(line.slice(5)) as { id?: number; result?: unknown },
    );
  const reply = (
    messages.length > 0
      ? messages
      : [JSON.parse(res.text) as { id?: number; result?: unknown }]
  ).find((m) => m.id === 2);
  const result = reply?.result as { content?: { text: string }[] } | undefined;
  return (result?.content ?? []).map((c) => c.text).join("\n");
}

/** UNIT_BOUNDARY_DESCRIPTION: waits until a knowledge base's share has published what its roots hold. */
export async function untilPublished(
  person: Person,
  agentId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const status = await person.api.kbShares.status.query({ agentId });
        return status?.publishState === "idle" &&
          (status.documentCount ?? 0) >= 1
          ? "published"
          : (status?.publishError ?? status?.publishState ?? "missing");
      },
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe("published");
}
