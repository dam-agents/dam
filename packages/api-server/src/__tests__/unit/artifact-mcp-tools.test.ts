import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import {
  createMcpSession,
  type McpSessionDeps,
} from "../../apps/harness-api-server/mcp-endpoint.js";

// TEST_OVERVIEW: The create_artifact MCP tool gates `interactive: true` on the `interactive-artifacts` feature flag. With the flag off, the create must refuse loudly and name the flag — otherwise the page would publish with no `answer_artifact_request` tool registered, and its asks would fail with no error anywhere. Static publishing must stay untouched by the flag.

async function mcpHarness(opts: { interactiveArtifacts: boolean }) {
  const creates: Record<string, unknown>[] = [];
  const artifactLibrary = {
    create: vi.fn(async (input: Record<string, unknown>) => {
      creates.push(input);
      return {
        id: "art-1",
        owner: "o1",
        title: input.title,
        kind: "html",
        visibility: "private",
        interactive: input.interactive ?? false,
        version: 1,
      };
    }),
  };

  const session = createMcpSession("agent-1", {
    channelManager: {},
    k8s: { namespace: "platform" },
    artifactLibrary,
    interactiveArtifacts: opts.interactiveArtifacts,
    experiments: { attachArtifact: async () => null },
  } as unknown as McpSessionDeps);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await session.server.connect(serverTransport);
  const client = new Client({ name: "test-harness", version: "1.0.0" });
  await client.connect(clientTransport);

  return { client, creates };
}

describe("create_artifact MCP tool — the interactive-artifacts flag", () => {
  // TEST_SCENARIO: Flag off, agent asks for an interactive page. The tool refuses before any row is written, and the message names the `interactive-artifacts` flag so the refusal can be acted on.
  it("refuses interactive: true when the flag is off, naming the flag", async () => {
    const { client, creates } = await mcpHarness({
      interactiveArtifacts: false,
    });

    const res = await client.callTool({
      name: "create_artifact",
      arguments: {
        title: "Live dashboard",
        content: "<!DOCTYPE html><html></html>",
        interactive: true,
      },
    });

    expect(res.isError).toBe(true);
    expect((res.content as [{ text: string }])[0].text).toContain(
      "interactive-artifacts",
    );
    expect(creates).toHaveLength(0);
  });

  // TEST_SCENARIO: Flag off, ordinary static publish. The flag gates only interactive pages, so a plain create must go through untouched.
  it("still publishes a static artifact with the flag off", async () => {
    const { client, creates } = await mcpHarness({
      interactiveArtifacts: false,
    });

    const res = await client.callTool({
      name: "create_artifact",
      arguments: {
        title: "Report",
        content: "<!DOCTYPE html><html></html>",
      },
    });

    expect(res.isError).toBeFalsy();
    expect(creates).toHaveLength(1);
  });

  // TEST_SCENARIO: Flag on, agent asks for an interactive page. The create reaches the service with `interactive: true` — the gate is the flag, nothing else.
  it("publishes an interactive page when the flag is on", async () => {
    const { client, creates } = await mcpHarness({
      interactiveArtifacts: true,
    });

    const res = await client.callTool({
      name: "create_artifact",
      arguments: {
        title: "Live dashboard",
        content: "<!DOCTYPE html><html></html>",
        interactive: true,
      },
    });

    expect(res.isError).toBeFalsy();
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ interactive: true });
  });
});
