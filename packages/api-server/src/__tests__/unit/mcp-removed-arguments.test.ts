/**
 * TEST_OVERVIEW: An MCP tool's input schema drops an argument it does not
 * declare. When an argument is removed from a tool, an Agent that still sends
 * it must get an error that names its replacement, and the tool must not run
 * without it. The removed name must not show in the tool list.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { refuseRemovedArguments } from "../../core/mcp-removed-arguments.js";

const GONE = "Nothing was sent: the card argument is gone. Send blocks.";

async function probe() {
  const calls: unknown[] = [];
  const rpc = async (method: string, params: unknown) => {
    const server = new McpServer({ name: "probe", version: "1" });
    server.registerTool(
      "reply",
      { inputSchema: { text: z.string() } },
      async (args) => {
        calls.push(args);
        return { content: [{ type: "text", text: "sent" }] };
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    refuseRemovedArguments(transport, { reply: { card: GONE } });
    const res = await transport.handleRequest(
      new Request("http://mcp/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    return res.json();
  };
  return { rpc, calls };
}

describe("refuseRemovedArguments", () => {
  /**
   * TEST_SCENARIO: An Agent in a running session still knows the old tool
   * list and sends `card`. Without the guard the schema would drop it and the
   * message would go out without its card. The call is answered with a tool
   * error instead, and the tool does not run.
   */
  it("answers a call that sends a removed argument with a tool error", async () => {
    const { rpc, calls } = await probe();

    const refused = await rpc("tools/call", {
      name: "reply",
      arguments: { text: "This week", card: { type: "Card" } },
    });

    expect(refused.result).toEqual({
      content: [{ type: "text", text: GONE }],
      isError: true,
    });
    expect(calls).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The guard must cost a normal call nothing. A call without
   * the removed argument runs, and the tool list does not name the argument.
   */
  it("lets every other call through and keeps the name out of the tool list", async () => {
    const { rpc, calls } = await probe();

    const sent = await rpc("tools/call", {
      name: "reply",
      arguments: { text: "This week" },
    });
    const listed = await rpc("tools/list", {});

    expect(sent.result.content).toEqual([{ type: "text", text: "sent" }]);
    expect(calls).toEqual([{ text: "This week" }]);
    expect(listed.result.tools[0].inputSchema.properties).not.toHaveProperty(
      "card",
    );
  });
});
