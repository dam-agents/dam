// TEST_OVERVIEW: the agent's set_artifact_sharing tool shares an artifact at any of the three levels and adds or removes viewers by email, through the same library sharing write the Share dialog uses. Adding viewers makes the artifact restricted unless the agent names a level. Every artifact the tools hand back lists its viewers, so the agent can say who has access. A refusal from the library, such as adding viewers to an interactive page, reaches the agent as a tool error with the library's reason.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ArtifactSharingInput, LibraryArtifact } from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import {
  createMcpSession,
  type McpSessionDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";

function libraryArtifact(overrides: Partial<LibraryArtifact>): LibraryArtifact {
  return {
    id: "art-1",
    title: "Quarterly report",
    slug: "slug-1",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "report.md",
    sizeBytes: 6,
    version: 1,
    folderId: null,
    sourcePath: null,
    agentId: "agent-1",
    visibility: "restricted",
    interactive: false,
    expiresAt: null,
    viewCount: 0,
    shareUrl: "https://share.example.com/a/slug-1",
    viewers: ["ada@example.com"],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

async function mcpHarness(
  setSharing: (
    id: string,
    input: ArtifactSharingInput,
  ) => Promise<LibraryArtifact> = async () => libraryArtifact({}),
) {
  const artifactLibrary = {
    setSharing: vi.fn(setSharing),
    get: vi.fn(async () => libraryArtifact({})),
    getContent: vi.fn(async () => ({
      content: "# Q3",
      binary: false,
      tooLarge: false,
    })),
    list: vi.fn(async () => [libraryArtifact({})]),
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

function resultJson(result: Awaited<ReturnType<Client["callTool"]>>) {
  const [block] = result.content as { type: string; text: string }[];
  return JSON.parse(block!.text) as Record<string, unknown>;
}

describe("artifact MCP tools — sharing with named people (#6284)", () => {
  // TEST_SCENARIO: the tool's description is the only guidance the agent gets, so it must name the three levels, say that sharing changes only when the user asks, and say why an interactive page stays with the owner's Share dialog.
  it("tells the agent the three levels, to act only when asked, and the interactive page rule", async () => {
    const { client } = await mcpHarness();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "set_artifact_sharing");
    expect(tool?.description).toContain("private (only the user");
    expect(tool?.description).toContain("restricted (only the user and");
    expect(tool?.description).toContain("public (anyone with the link)");
    expect(tool?.description).toContain(
      "Change sharing only when the user asks",
    );
    expect(tool?.description).toContain("recommend the narrowest that fits");
    expect(tool?.description).toContain(
      "you cannot add viewers to it or make it restricted",
    );
    const properties = tool?.inputSchema.properties as
      Record<string, { enum?: string[] }> | undefined;
    expect(properties?.visibility?.enum).toEqual([
      "private",
      "restricted",
      "public",
    ]);
    expect(properties).toHaveProperty("add_viewers");
    expect(properties).toHaveProperty("remove_viewers");
  });

  // TEST_SCENARIO: a user asks the agent to share a private report with two colleagues; adding viewers without a level makes it restricted, and the result names who has access.
  it("makes the artifact restricted when it adds viewers, and returns the viewers", async () => {
    const { client, artifactLibrary } = await mcpHarness(async () =>
      libraryArtifact({ viewers: ["ada@example.com", "bob@example.com"] }),
    );
    const result = await client.callTool({
      name: "set_artifact_sharing",
      arguments: {
        id: "art-1",
        add_viewers: ["ada@example.com", "bob@example.com"],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(artifactLibrary.setSharing).toHaveBeenCalledWith("art-1", {
      visibility: "restricted",
      addViewers: ["ada@example.com", "bob@example.com"],
    });
    expect(resultJson(result)).toMatchObject({
      visibility: "restricted",
      viewers: ["ada@example.com", "bob@example.com"],
    });
  });

  // TEST_SCENARIO: removing a viewer leaves the level as it is, and a level the agent names wins over the restricted default of adding viewers.
  it("passes removals and a named level through unchanged", async () => {
    const { client, artifactLibrary } = await mcpHarness();
    await client.callTool({
      name: "set_artifact_sharing",
      arguments: { id: "art-1", remove_viewers: ["bob@example.com"] },
    });
    expect(artifactLibrary.setSharing).toHaveBeenLastCalledWith("art-1", {
      visibility: undefined,
      removeViewers: ["bob@example.com"],
    });
    await client.callTool({
      name: "set_artifact_sharing",
      arguments: {
        id: "art-1",
        visibility: "private",
        add_viewers: ["cy@example.com"],
      },
    });
    expect(artifactLibrary.setSharing).toHaveBeenLastCalledWith("art-1", {
      visibility: "private",
      addViewers: ["cy@example.com"],
    });
  });

  // TEST_SCENARIO: the library refuses to add viewers to an interactive page; the agent gets that reason as a tool error, so it can tell the user to share the page from the Share dialog.
  it("reports the library's refusal as a tool error", async () => {
    const { client } = await mcpHarness(async () => {
      throw new Error(
        "Only the owner shares it with named people, in the app's Share dialog.",
      );
    });
    const result = await client.callTool({
      name: "set_artifact_sharing",
      arguments: { id: "art-1", add_viewers: ["ada@example.com"] },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Share dialog");
  });

  // TEST_SCENARIO: the user asks who can see an artifact; get_artifact and list_artifacts both carry the viewer list.
  it("lists the viewers when the agent reads its artifacts back", async () => {
    const { client } = await mcpHarness();
    const got = await client.callTool({
      name: "get_artifact",
      arguments: { id: "art-1" },
    });
    expect(resultJson(got)).toMatchObject({ viewers: ["ada@example.com"] });
    const listed = await client.callTool({
      name: "list_artifacts",
      arguments: {},
    });
    const [block] = listed.content as { text: string }[];
    expect(JSON.parse(block!.text)).toEqual([
      expect.objectContaining({ viewers: ["ada@example.com"] }),
    ]);
  });
});
