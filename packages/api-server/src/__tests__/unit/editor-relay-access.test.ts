// TEST_OVERVIEW: An Agent Editor opens a Shared Agent's live sockets like its owner, as far as their Agent Permissions reach. The chat, the runtime's tRPC socket and the browser stream need `sessions`; a terminal and SSH need `terminal`, which only the owner holds. When the owner removes the editor, or deletes the Agent, every replica closes that editor's open sockets with "access revoked", so a removed editor loses an open chat at once.
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import type { AgentPermission } from "api-server-api";
import { createRelayAdmission } from "../../apps/api-server/agent-proxies/upgrade.js";
import {
  ACCESS_REVOKED_CODE,
  createEditorSockets,
} from "../../apps/api-server/agent-proxies/editor-sockets.js";
import type { RedisBus } from "../../core/redis-bus.js";
import { emit, EventType } from "../../events.js";

const securityLog = vi.hoisted(() => vi.fn());
vi.mock("../../core/security-log.js", () => ({ securityLog }));

const EDITOR_PERMISSIONS: AgentPermission[] = ["view", "sessions"];

function admission() {
  return createRelayAdmission({
    authenticate: async (token) =>
      ({
        ok: true,
        principal: {
          user: {
            sub: token,
            preferredUsername: token,
            scopes: ["agents:operate"],
            agentIds: "*",
          },
          azp: "platform-ui",
          roles: [],
        },
      }) as never,
    standingOf: async (_agentId, user) =>
      user.sub === "bob"
        ? {
            role: "editor",
            email: "bob@example.com",
            ownerSub: "alice",
            permissions: EDITOR_PERMISSIONS,
          }
        : user.sub === "alice"
          ? { role: "owner" }
          : null,
    editorSockets: { track: () => {}, close: () => {} },
    isTermsAccepted: async () => true,
    surfaceAttribution: { uiClientId: "platform-ui", cliClientId: "cli" },
  });
}

const admit = (who: string, kind: string, permission: AgentPermission) =>
  admission()(
    { headers: {}, socket: {} } as IncomingMessage,
    new URL(`http://x/api/agents/bot/${kind}?token=${who}`),
    "bot",
    { kind, permission },
  );

describe("who opens a shared agent's live sockets", () => {
  // TEST_SCENARIO: An editor who holds sessions opens the chat. The relay learns who the owner is and what the editor holds, and the admission is an audit record naming the editor and the owner.
  it("admits an editor to the chat", async () => {
    securityLog.mockClear();
    const admitted = await admit("bob", "acp", "sessions");
    expect(admitted).toMatchObject({
      ok: true,
      editor: {
        email: "bob@example.com",
        ownerSub: "alice",
        permissions: EDITOR_PERMISSIONS,
      },
    });
    expect(securityLog).toHaveBeenCalledWith(
      "info",
      "agent.editor_act",
      expect.objectContaining({
        actor: "bob",
        detail: { ownerSub: "alice", permission: "sessions", relay: "acp" },
      }),
    );
  });

  // TEST_SCENARIO: Terminals and SSH need the terminal permission, which only the owner holds. An editor is refused with 403, the owner is admitted, and a stranger reads as an agent that does not exist.
  it("keeps terminals with the owner", async () => {
    expect(await admit("bob", "terminal", "terminal")).toEqual({
      ok: false,
      kind: "not-permitted",
    });
    expect(await admit("alice", "terminal", "terminal")).toMatchObject({
      ok: true,
      editor: null,
    });
    expect(await admit("carol", "acp", "sessions")).toEqual({
      ok: false,
      kind: "not-owner",
    });
  });
});

function memoryBus(): RedisBus {
  const listeners = new Map<string, Set<(payload: string) => void>>();
  return {
    publish: async (channel, payload) => {
      for (const listener of listeners.get(channel) ?? []) listener(payload);
    },
    subscribe: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => set.delete(listener);
    },
    close: async () => {},
  };
}

function fakeClient() {
  const client = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN as number,
    close: vi.fn(),
    terminate: vi.fn(),
  });
  return client;
}

describe("an editor losing access with a socket open", () => {
  // TEST_SCENARIO: The owner removes one of two editors while both have the chat open. Only the removed editor's socket closes, with "access revoked"; the editor still on the list keeps working.
  it("closes the removed editor's socket", async () => {
    const listed = new Set(["bob@example.com", "dan@example.com"]);
    const sockets = createEditorSockets({
      bus: memoryBus(),
      editorStanding: async (_agentId, caller) =>
        listed.has(caller.editorEmail)
          ? { ownerSub: "alice", permissions: EDITOR_PERMISSIONS }
          : null,
    });
    const bob = fakeClient();
    const dan = fakeClient();
    sockets.track(
      "bot",
      { sub: "bob", email: "bob@example.com" },
      bob as unknown as WebSocket,
    );
    sockets.track(
      "bot",
      { sub: "dan", email: "dan@example.com" },
      dan as unknown as WebSocket,
    );

    listed.delete("bob@example.com");
    emit({
      type: EventType.AgentEditorsChanged,
      agentId: "bot",
      ownerSub: "alice",
      emails: ["bob@example.com"],
    });

    await vi.waitFor(() =>
      expect(bob.close).toHaveBeenCalledWith(
        ACCESS_REVOKED_CODE,
        "access revoked",
      ),
    );
    expect(dan.close).not.toHaveBeenCalled();
    sockets.close();
  });

  // TEST_SCENARIO: A socket that already closed is forgotten, so a later change to the list does not touch it.
  it("forgets a closed socket", async () => {
    const editorStanding = vi.fn(async () => null);
    const sockets = createEditorSockets({ bus: memoryBus(), editorStanding });
    const bob = fakeClient();
    sockets.track(
      "bot",
      { sub: "bob", email: "bob@example.com" },
      bob as unknown as WebSocket,
    );
    bob.emit("close");

    emit({ type: EventType.AgentDeleted, agentId: "bot", ownerSub: "alice" });
    await Promise.resolve();
    expect(editorStanding).not.toHaveBeenCalled();
    sockets.close();
  });
});
