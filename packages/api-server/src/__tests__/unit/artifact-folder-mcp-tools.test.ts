import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import {
  createMcpSession,
  type McpSessionDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";

async function mcpHarness() {
  const artifactLibrary = {
    create: vi.fn(async (input: { title: string; folderId?: string }) => ({
      id: "art-1",
      title: input.title,
      slug: "slug-1",
      kind: "markdown",
      contentType: "text/markdown",
      fileName: "report.md",
      sizeBytes: 6,
      version: 1,
      folderId: input.folderId ?? null,
      agentId: "agent-1",
      visibility: "private",
      interactive: false,
      expiresAt: null,
      viewCount: 0,
      shareUrl: null,
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    })),
  };

  const session = createMcpSession("agent-1", {
    channelManager: {},
    k8s: { namespace: "platform" },
    maxArtifactBytes: 10 * 1024 * 1024,
    artifactLibrary,
  } as unknown as McpSessionDeps);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await session.server.connect(serverTransport);
  const client = new Client({ name: "test-harness", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, artifactLibrary };
}

describe("artifact MCP tools — publishing into the user's folders (#4892)", () => {
  it("tells the agent to file a new artifact into the folder that fits, and to leave it ungrouped otherwise", async () => {
    const { client } = await mcpHarness();
    const { tools } = await client.listTools();
    const byName = (name: string) => tools.find((t) => t.name === name);

    const create = byName("create_artifact");
    expect(create?.description).toContain("call list_artifact_folders");
    expect(create?.description).toContain("leave the artifact ungrouped");
    expect(create?.description).toContain("which folder it went into");
    const properties = create?.inputSchema.properties as
      Record<string, { description?: string }> | undefined;
    expect(properties?.folder_id?.description).toContain(
      "list_artifact_folders",
    );

    expect(byName("list_artifact_folders")?.description).toContain(
      "before create_artifact",
    );
    expect(byName("create_artifact_folder")?.description).toContain(
      "Only when the user asks for one",
    );
  });

  it("passes the chosen folder to the library", async () => {
    const { client, artifactLibrary } = await mcpHarness();

    const result = await client.callTool({
      name: "create_artifact",
      arguments: {
        title: "Weekly report",
        content: "# Week",
        folder_id: "f-reports",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(artifactLibrary.create).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: "f-reports" }),
      { author: "agent", agentId: "agent-1" },
    );
  });
});
