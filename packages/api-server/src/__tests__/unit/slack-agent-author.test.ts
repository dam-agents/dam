// TEST_OVERVIEW: One Slack app posts for every agent, so with agent avatars on, an agent's own posts carry its name and avatar icon in place of the app's. That needs the workspace to have granted chat:write.customize; without it, or with the switch off, posts keep the app's own identity.
import type { AgentsService } from "api-server-api";
import { describe, expect, it } from "vitest";

import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import type { SlackPostMessage } from "../../modules/channels/infrastructure/slack-gateway.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";

const BOUND = "C-BOUND";
configureLogger({ level: "error", write: () => {} });

function harness(opts: {
  scopes: string[] | null;
  icon: ((owner: string, name: string) => string) | null;
  agentName?: string | null;
  owner?: string | null;
}) {
  const gw = createFakeSlackGateway();
  gw.setChannels([{ id: BOUND, name: "agent-home", botIsMember: true }], "");
  gw.setGrantedScopes(opts.scopes);
  const posted: SlackPostMessage[] = [];
  const post = gw.postMessage.bind(gw);
  gw.postMessage = async (args) => {
    posted.push(args);
    return post(args);
  };
  const agents = {
    ensureReady: async () => {},
    get: async () =>
      opts.agentName === null
        ? null
        : { name: opts.agentName ?? "velvet-comet" },
  } as unknown as AgentsService;
  const worker = createSlackWorker(
    () => ({}) as unknown as AcpClient,
    () => gw,
    () => agents,
    { resolve: async () => null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => (opts.owner === undefined ? "owner-1" : opts.owner),
    {
      resolveSlackBindings: async () => [],
      resolveSlackChannelsByInstance: async () => [{ id: BOUND, teamId: "" }],
    },
    async () => {},
    async () => {},
    async () => true,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    (teamId) => teamId,
    () => {},
    0,
    {},
    opts.icon,
  );
  return {
    posted,
    async send(text: string) {
      await worker.start("agent-1", {} as StoredChannelConfig);
      return worker.postMessage("agent-1", text);
    },
  };
}

const icon = (owner: string, name: string) =>
  `https://dam.example/api/public/avatars/v1/${owner}-${name}.png`;

describe("slack agent author", () => {
  // TEST_SCENARIO: The operator switched agent avatars on and the workspace granted the scope. The agent's post shows its own name and avatar.
  it("posts as the agent when enabled and the scope is granted", async () => {
    const h = harness({ scopes: ["chat:write", "chat:write.customize"], icon });
    expect(await h.send("hello")).toEqual({ ok: true });
    expect(h.posted.at(-1)?.author).toEqual({
      username: "velvet-comet",
      iconUrl: icon("owner-1", "velvet-comet"),
    });
  });

  // TEST_SCENARIO: The workspace was installed before the scope was added and never re-installed. Posting still works, as the app.
  it("keeps the app's identity when the workspace lacks the scope", async () => {
    const h = harness({ scopes: ["chat:write"], icon });
    expect(await h.send("hello")).toEqual({ ok: true });
    expect(h.posted.at(-1)?.author).toBeUndefined();
  });

  // TEST_SCENARIO: Slack could not report what the workspace granted. Sending a name and icon the workspace may not allow is not worth the risk, so the post goes out as the app.
  it("keeps the app's identity when the granted scopes are unknown", async () => {
    const h = harness({ scopes: null, icon });
    await h.send("hello");
    expect(h.posted.at(-1)?.author).toBeUndefined();
  });

  // TEST_SCENARIO: The switch is off. Nothing about a post changes, whatever the workspace granted.
  it("keeps the app's identity when the switch is off", async () => {
    const h = harness({
      scopes: ["chat:write", "chat:write.customize"],
      icon: null,
    });
    await h.send("hello");
    expect(h.posted.at(-1)?.author).toBeUndefined();
  });

  // TEST_SCENARIO: The agent's owner could not be read. The face is drawn from owner and name together, so without the owner it would not match the UI's; the post goes out as the app.
  it("keeps the app's identity when the agent's owner cannot be resolved", async () => {
    const h = harness({
      scopes: ["chat:write", "chat:write.customize"],
      icon,
      owner: null,
    });
    await h.send("hello");
    expect(h.posted.at(-1)?.author).toBeUndefined();
  });

  // TEST_SCENARIO: The agent's name could not be read. The id would hash to a different face than the UI shows, so the post goes out as the app.
  it("keeps the app's identity when the agent's name cannot be resolved", async () => {
    const h = harness({
      scopes: ["chat:write", "chat:write.customize"],
      icon,
      agentName: null,
    });
    await h.send("hello");
    expect(h.posted.at(-1)?.author).toBeUndefined();
  });
});
