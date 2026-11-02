// TEST_OVERVIEW: The owning agent's Environment tools never decide who may open an Environment: `access`, which an agent passed before only people decided, is refused at create and at update with a message that says a person shares it in the app, and nothing is created or changed; without it the tools work as before, and the list says how many people may open each, never who.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { AgentEnvironmentView } from "api-server-api";
import { registerEnvironmentTools } from "../../modules/environments/mcp-tools.js";
import type { OwningAgentEnvironments } from "../../modules/environments/services/environments-service.js";

const view: AgentEnvironmentView = {
  id: "agent-env1",
  owningAgentId: "agent-dev",
  name: "pr-1",
  endpoints: [{ name: "app", port: 4444, url: null }],
  peopleWhoMayOpen: 2,
  expiresAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  state: "running",
};

async function tools() {
  const environments = {
    create: vi.fn(async () => view),
    list: vi.fn(async () => [view]),
    update: vi.fn(async () => view),
    wake: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  } satisfies OwningAgentEnvironments;
  const server = new McpServer({ name: "test", version: "1" });
  registerEnvironmentTools(server, { environments });
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: "agent", version: "1" });
  await mcp.connect(client);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await mcp.callTool({ name, arguments: args });
    const [content] = result.content as { text: string }[];
    return { isError: result.isError === true, text: content!.text };
  };
  return { call, environments };
}

const endpoints = [{ name: "app", port: 4444 }];

describe("who may open an Environment, from the agent's tools", () => {
  // TEST_SCENARIO: an agent asked in chat to share its Environment with an address passes it as `access`; the tool refuses it, says only a person can share it in the app, and creates or changes nothing.
  it("refuses an access list at create and at update", async () => {
    const { call, environments } = await tools();

    const created = await call("create_environment", {
      name: "pr-1",
      endpoints,
      access: ["stranger@example.com"],
    });
    const updated = await call("update_environment", {
      name: "pr-1",
      access: ["stranger@example.com"],
    });

    for (const result of [created, updated]) {
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/only a person can share an Environment/);
    }
    expect(environments.create).not.toHaveBeenCalled();
    expect(environments.update).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: without `access` the tools create and list as before, and what the agent reads is a count of the people who may open it, with no email.
  it("creates and lists with only a count of people", async () => {
    const { call, environments } = await tools();

    expect(
      (await call("create_environment", { name: "pr-1", endpoints })).isError,
    ).toBe(false);
    expect(environments.create).toHaveBeenCalledWith({
      name: "pr-1",
      endpoints,
    });
    const listed = await call("list_environments", {});
    expect(JSON.parse(listed.text)).toEqual([view]);
    expect(listed.text).not.toContain("@");
  });
});
