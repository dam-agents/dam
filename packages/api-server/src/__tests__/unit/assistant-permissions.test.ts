// TEST_OVERVIEW: The assistant is the one Agent the platform provisions for a person, so nobody holds the four Agent Permissions that would remove it, share it, disable it or bind it to a conversation — not its owner, and not an editor, whose standing on an assistant grants nothing at all. Each procedure that needs one is refused with a message naming the assistant, and the service is never reached; every permission the plan allows, including releasing a binding it already has, still runs.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext, UserIdentity } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { permissionsOf } from "../../modules/agents/domain/agent-permissions.js";
import { createActOnAgent } from "../../apps/api-server/trpc/act-on-agent.js";

const OWNER = "alice";
const ASSISTANT = "agent-00000000000000a1";
const ASSISTANT_NAME = "Dambledore";

const person = (): UserIdentity => ({
  sub: OWNER,
  preferredUsername: OWNER,
  scopes: ["agents:manage", "agents:operate", "credentials:manage"],
  agentIds: "*",
  email: "alice@example.com",
  emailVerified: true,
});

const ASSISTANT_PERMISSIONS = permissionsOf("owner", "assistant");

/** UNIT_BOUNDARY_DESCRIPTION: a service call that answers by saying it was reached, so a test can tell an allowed procedure from a refused one without faking an Agent. */
const reached = (name: string) =>
  vi.fn(async (): Promise<never> => {
    throw new Error(`reached ${name}`);
  });

function world() {
  const agents = {
    delete: reached("delete"),
    update: reached("update"),
    setEditors: reached("setEditors"),
    setDisabled: reached("setDisabled"),
    setWhisper: reached("setWhisper"),
    connectSlack: reached("connectSlack"),
    disconnectSlack: reached("disconnectSlack"),
    sleep: reached("sleep"),
    restart: reached("restart"),
    upgrade: reached("upgrade"),
    bindSlackChannel: reached("bindSlackChannel"),
    bindTelegramChat: reached("bindTelegramChat"),
  };
  const ctx = {
    user: person(),
    agents,
    channels: { available: { slack: true, telegram: true } },
    actOnAgent: createActOnAgent({
      user: person(),
      self: () => ctx as unknown as ApiContext,
      agentOfTarget: async (target) =>
        target.kind === "agent" ? { agentId: target.agentId, needs: [] } : null,
      ownerPermissions: async (agentId) =>
        agentId === ASSISTANT ? ASSISTANT_PERMISSIONS : null,
      editorStanding: async () => null,
      contextFor: () => ctx as unknown as ApiContext,
      assistantName: ASSISTANT_NAME,
    }),
  } as unknown as ApiContext;
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), agents };
}

describe("the assistant's Agent Permissions", () => {
  // TEST_SCENARIO: the procedures that would delete, share, disable or bind the assistant are refused with a message naming it, and none of them reaches the service.
  it("refuses delete, editors, disable and binding, naming the assistant", async () => {
    const w = world();
    const cases: Promise<unknown>[] = [
      w.caller.agents.delete({ id: ASSISTANT }),
      w.caller.agents.setEditors({
        id: ASSISTANT,
        editors: ["bob@example.com"],
      }),
      w.caller.agents.setDisabled({ id: ASSISTANT, disabled: true }),
      w.caller.agents.bindSlackChannel({
        agentId: ASSISTANT,
        flowId: "flow-1",
      }),
      w.caller.agents.bindTelegramChat({
        agentId: ASSISTANT,
        flowId: "flow-1",
      }),
      w.caller.agents.connectSlack({
        id: ASSISTANT,
        slackChannelId: "C1",
      }),
    ];
    for (const call of cases) {
      await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(call).rejects.toThrow(ASSISTANT_NAME);
    }
    expect(w.agents.delete).not.toHaveBeenCalled();
    expect(w.agents.setEditors).not.toHaveBeenCalled();
    expect(w.agents.setDisabled).not.toHaveBeenCalled();
    expect(w.agents.bindSlackChannel).not.toHaveBeenCalled();
    expect(w.agents.bindTelegramChat).not.toHaveBeenCalled();
    expect(w.agents.connectSlack).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: what the plan allows on the assistant still runs: whispers, releasing a binding it already has, sleep and wake, restart, the image upgrade, its settings and its model providers.
  it("allows whispers, releasing a binding, lifecycle, settings and providers", async () => {
    const w = world();
    const allowed: [string, Promise<unknown>][] = [
      ["update", w.caller.agents.setWhisper({ id: ASSISTANT, whisper: false })],
      ["disconnectSlack", w.caller.agents.disconnectSlack({ id: ASSISTANT })],
      ["sleep", w.caller.agents.sleep({ id: ASSISTANT })],
      ["restart", w.caller.agents.restart({ id: ASSISTANT })],
      ["upgrade", w.caller.agents.upgrade({ id: ASSISTANT })],
      [
        "update",
        w.caller.agents.update({ id: ASSISTANT, description: "my helper" }),
      ],
    ];
    for (const [name, call] of allowed)
      await expect(call).rejects.toThrow(`reached ${name}`);
  });
});

describe("permissionsOf on the assistant", () => {
  // TEST_SCENARIO: the owner's set keeps everything but the four refused permissions; an editor's set on an assistant loses the one nobody holds there, while an editor of any other Agent keeps every permission it had.
  it("leaves out exactly the four refused permissions", () => {
    const refused = ["delete", "editors", "disable", "channelBinding"];
    const assistant: readonly string[] = permissionsOf("owner", "assistant");
    expect(refused.filter((p) => assistant.includes(p))).toEqual([]);
    expect(permissionsOf("owner", "knowledge-base")).toContain("delete");
    expect(permissionsOf("owner", undefined)).toContain("delete");
    expect(permissionsOf("editor", "assistant")).not.toContain("disable");
    expect(permissionsOf("editor", "assistant")).toContain("lifecycle");
    expect(permissionsOf("editor", "knowledge-base")).toContain("disable");
  });
});
