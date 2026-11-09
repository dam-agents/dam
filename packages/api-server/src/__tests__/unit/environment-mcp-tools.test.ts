// TEST_OVERVIEW: The owning agent's Environment tools take each endpoint's readiness path, at create and at update, and never decide who may open an Environment: `access`, which an agent passed before only people decided, is refused at create and at update with a message that says a person shares it in the app, and nothing is created or changed; without it the tools work as before, and the list says how many people may open each, never who. An `idle_timeout` reaches create and update as whole minutes, or "never", and its description names the install's own default and maximum; `expires` takes "never" too.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentEnvironmentView,
  SharedEnvironmentView,
} from "api-server-api";
import { registerEnvironmentTools } from "../../modules/environments/mcp-tools.js";
import type { OwningAgentEnvironments } from "../../modules/environments/services/environments-service.js";

const view: AgentEnvironmentView = {
  id: "agent-env1",
  owningAgentId: "agent-dev",
  name: "pr-1",
  endpoints: [{ name: "app", port: 4444, url: null }],
  peopleWhoMayOpen: 2,
  expiresAt: new Date().toISOString(),
  idleTimeoutMin: 60,
  createdAt: new Date().toISOString(),
  state: "running",
};

const shared: SharedEnvironmentView = {
  id: "agent-env9",
  name: "pr-9",
  sharedWithYou: true,
  owningAgentName: "bob's dev",
  ownerName: "Bob",
  endpoints: [
    { name: "app", port: 4444, url: "https://app-pr-9-abc.env.example" },
  ],
  expiresAt: new Date().toISOString(),
  state: "sleeping",
};

async function tools(manage = true) {
  const environments = {
    idleTimeout: { defaultMin: 45, maxMin: 600 },
    manage,
    shared: vi.fn(async () => [shared]),
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
  return { call, environments, mcp };
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
    expect(JSON.parse(listed.text)).toEqual([view, shared]);
    expect(listed.text).not.toContain("@");
  });
});

describe("an endpoint's readiness path, from the agent's tools", () => {
  // TEST_SCENARIO: the agent declares a readiness path on an endpoint at create and sets or removes one by endpoint name at update; a path that does not start with a slash is refused before the service sees it.
  it("takes readiness paths at create and update", async () => {
    const { call, environments } = await tools();

    await call("create_environment", {
      name: "pr-1",
      endpoints: [{ name: "app", port: 4444, ready: "/healthz" }],
    });
    expect(environments.create).toHaveBeenCalledWith({
      name: "pr-1",
      endpoints: [{ name: "app", port: 4444, ready: "/healthz" }],
    });

    await call("update_environment", {
      name: "pr-1",
      ready: { app: "/up", auth: null },
    });
    expect(environments.update).toHaveBeenCalledWith("pr-1", {
      ready: { app: "/up", auth: null },
    });

    const refused = await call("create_environment", {
      name: "pr-2",
      endpoints: [{ name: "app", port: 4444, ready: "healthz" }],
    });
    expect(refused.isError).toBe(true);
    expect(environments.create).toHaveBeenCalledTimes(1);
  });
});

describe("Environments shared with an agent", () => {
  // TEST_SCENARIO: an agent whose owner does not have Environments is listed on another user's Environment. It gets only the list, marked shared, and none of the tools that create or change one.
  it("lists only what is shared when the agent may not own Environments", async () => {
    const { call, environments } = await tools(false);
    const listed = await call("list_environments", {});
    expect(JSON.parse(listed.text)).toEqual([shared]);
    expect(environments.list).not.toHaveBeenCalled();
    const create = await call("create_environment", {
      name: "pr-1",
      endpoints,
    });
    expect(create.isError).toBe(true);
  });
});

describe("an Environment's idle timeout, from the agent's tools", () => {
  // TEST_SCENARIO: an agent gives `idle_timeout` as it gives `expires`; create and update pass it on in minutes, "never" or 0 passes on as never sleeping, and a word the tool does not know is refused with a message, with nothing changed.
  it("passes an idle timeout on in minutes, or never", async () => {
    const { call, environments } = await tools();

    await call("create_environment", {
      name: "pr-1",
      endpoints,
      idle_timeout: "90m",
    });
    await call("update_environment", { name: "pr-1", idle_timeout: "4h" });
    await call("update_environment", { name: "pr-1", idle_timeout: "never" });
    await call("update_environment", { name: "pr-1", idle_timeout: "0" });
    const off = await call("update_environment", {
      name: "pr-1",
      idle_timeout: "off",
    });

    expect(environments.create).toHaveBeenCalledWith({
      name: "pr-1",
      endpoints,
      idleTimeoutMin: 90,
    });
    expect(environments.update.mock.calls).toEqual([
      ["pr-1", { idleTimeoutMin: 240 }],
      ["pr-1", { idleTimeoutMin: "never" }],
      ["pr-1", { idleTimeoutMin: "never" }],
    ]);
    expect(off.isError).toBe(true);
    expect(off.text).toMatch(/"never"/);
  });

  // TEST_SCENARIO: AC-2 — an agent asked for an Environment that never expires passes `expires: "never"`, and the tool hands the service "never", not a date; update takes it too.
  it("passes an expiry of never on at create and update", async () => {
    const { call, environments } = await tools();

    await call("create_environment", {
      name: "pr-1",
      endpoints,
      expires: "never",
    });
    await call("update_environment", { name: "pr-1", expires: "never" });

    expect(environments.create).toHaveBeenCalledWith({
      name: "pr-1",
      endpoints,
      expiresAt: "never",
    });
    expect(environments.update).toHaveBeenCalledWith("pr-1", {
      expiresAt: "never",
    });
  });

  // TEST_SCENARIO: an install may set its own default and maximum for Environments, so the tools describe `idle_timeout` with the values the service applies, never a constant that a configured install does not use.
  it("describes the install's own default and maximum", async () => {
    const { mcp } = await tools();

    const { tools: listed } = await mcp.listTools();
    for (const name of ["create_environment", "update_environment"]) {
      const schema = listed.find((t) => t.name === name)!.inputSchema as {
        properties: Record<string, { description?: string }>;
      };
      const description = schema.properties.idle_timeout!.description!;
      expect(description).toMatch(/Default 45 minutes/);
      expect(description).toMatch(/at most 600 minutes/);
    }
  });
});
