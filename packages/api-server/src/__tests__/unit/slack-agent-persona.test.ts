// TEST_OVERVIEW: With the chat:write.customize scope, an agent's Slack posts carry the agent's name as username and its avatar as icon_url, so a channel with several agents shows who said what. Without the scope, or when the granted set is unknown, posts go out under the app's own identity. The icon is the agent's chosen character, or the one picked from its owner and name when none is chosen. Each character is uploaded to ImgBB once, as a PNG named by a hash, and a failed upload is retried after a pause.
import { describe, it, expect, vi } from "vitest";
import { avatarCharacter } from "api-server-api/avatar/svg";
import type { AgentsService } from "api-server-api";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { configureLogger } from "../../core/logger.js";
import type { AcpClient } from "../../core/acp-client.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import {
  type AgentIconUrl,
  createImgbbAgentIcons,
} from "../../modules/channels/infrastructure/agent-avatar-icons.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";

const OWNER = "kc|owner-1";
const BOUND = "C-BOUND";
const ICON = "https://i.ibb.co/abc/icon.png";
configureLogger({ level: "error", write: () => {} });

function harness(
  scopes: string[] | null,
  agentIcon: AgentIconUrl | null,
  avatar?: string,
) {
  const gw = createFakeSlackGateway();
  gw.setChannels([{ id: BOUND, name: "agent-home", botIsMember: true }]);
  gw.setGrantedScopes(scopes);
  const agents = {
    get: async () => ({ name: "Scout", spec: { avatar } }),
  } as unknown as AgentsService;
  const worker = createSlackWorker({
    makeAcpClient: () => ({}) as AcpClient,
    createGateway: () => gw,
    agents: () => agents,
    identityLinks: { resolve: async () => null } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => OWNER,
    channelRegistry: {
      resolveSlackBindings: async () => [],
      resolveSlackChannelsByInstance: async () => [{ id: BOUND, teamId: "" }],
    },
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    listWorkspaces: async () => [],
    emit: () => {},
    settleMs: 0,
    wakeWait: {},
    agentIcon,
  });
  return {
    async post() {
      await worker.connect();
      expect(await worker.postMessage("agent-1", "hello")).toEqual({
        ok: true,
      });
      const [message] = gw.readOutbound();
      return message;
    },
    async reply() {
      await worker.connect();
      expect(
        await worker.reply("agent-1", { text: "hi", threadTs: "1.1" }),
      ).toEqual({ ok: true });
      const [message] = gw.readOutbound();
      return message;
    },
  };
}

describe("slack agent persona", () => {
  // TEST_SCENARIO: The scope is granted and the agent chose no character, so both agent-authored paths name the agent and show the character picked from its owner and name.
  it("posts and replies as the agent when chat:write.customize is granted", async () => {
    const seen: string[] = [];
    const icon: AgentIconUrl = async (character) => {
      seen.push(character);
      return ICON;
    };

    const post = await harness(
      ["chat:write", "chat:write.customize"],
      icon,
    ).post();
    const reply = await harness(
      ["chat:write", "chat:write.customize"],
      icon,
    ).reply();

    expect(post).toMatchObject({ username: "Scout", iconUrl: ICON });
    expect(reply).toMatchObject({ username: "Scout", iconUrl: ICON });
    const hashed = avatarCharacter(undefined, OWNER, "Scout");
    expect(seen).toEqual([hashed, hashed]);
  });

  // TEST_SCENARIO: A character the owner chose wins over the one picked from the name, so Slack shows the same character as the UI.
  it("shows the agent's chosen character", async () => {
    const seen: string[] = [];
    const icon: AgentIconUrl = async (character) => {
      seen.push(character);
      return ICON;
    };
    const chosen =
      avatarCharacter(undefined, OWNER, "Scout") === "lens" ? "wave" : "lens";

    await harness(["chat:write.customize"], icon, chosen).post();

    expect(seen).toEqual([chosen]);
  });

  // TEST_SCENARIO: Without the scope Slack may refuse or ignore the override, and with an unknown granted set nothing proves it is allowed, so the post keeps the app's identity.
  it("keeps the app's identity when the scope is withheld or unknown", async () => {
    for (const scopes of [["chat:write"], null]) {
      const message = await harness(scopes, async () => ICON).post();
      expect(message).not.toHaveProperty("username");
      expect(message).not.toHaveProperty("iconUrl");
    }
  });

  // TEST_SCENARIO: No image host is configured, or the upload failed: the name still helps, so the post carries it with the app's icon.
  it("names the agent without an icon when none is available", async () => {
    for (const icon of [null, async () => null]) {
      const message = await harness(["chat:write.customize"], icon).post();
      expect(message).toMatchObject({ username: "Scout" });
      expect(message).not.toHaveProperty("iconUrl");
    }
  });
});

describe("imgbb agent icons", () => {
  function fakeImgbb(responses: Array<() => Response>) {
    const uploads: FormData[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      uploads.push(init.body as FormData);
      return responses.shift()!();
    }) as unknown as typeof fetch;
    return { uploads, fetchImpl };
  }
  const ok = () => Response.json({ data: { url: ICON } });

  // TEST_SCENARIO: The first post with a character uploads its PNG under a hashed filename, later posts with that character reuse the URL, and another character gets its own upload.
  it("uploads a hashed PNG once per character", async () => {
    const imgbb = fakeImgbb([ok, ok]);
    const icons = createImgbbAgentIcons("secret", imgbb.fetchImpl);

    expect(await icons("lens")).toBe(ICON);
    expect(await icons("lens")).toBe(ICON);
    expect(imgbb.uploads).toHaveLength(1);
    expect(await icons("wave")).toBe(ICON);

    expect(imgbb.uploads).toHaveLength(2);
    const form = imgbb.uploads[0]!;
    expect(form.get("key")).toBe("secret");
    const image = form.get("image") as File;
    expect(image.type).toBe("image/png");
    expect(image.name).toMatch(/^[0-9a-f]{16}\.png$/);
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  // TEST_SCENARIO: A failed upload answers null and is remembered, so the next posts don't pay for another attempt; after RETRY_AFTER_MS (10 minutes) the upload is tried again.
  it("remembers a failed upload for ten minutes, then retries", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const imgbb = fakeImgbb([
        () => new Response("down", { status: 503 }),
        () => Response.json({ data: { url: "http://not-https" } }),
        ok,
      ]);
      const icons = createImgbbAgentIcons("secret", imgbb.fetchImpl);

      expect(await icons("lens")).toBeNull();
      expect(await icons("lens")).toBeNull();
      expect(imgbb.uploads).toHaveLength(1);

      vi.advanceTimersByTime(10 * 60_000);
      expect(await icons("lens")).toBeNull();
      vi.advanceTimersByTime(10 * 60_000);
      expect(await icons("lens")).toBe(ICON);
      expect(imgbb.uploads).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // TEST_SCENARIO: A slow image host must not hold up the Slack post: past the wait the post goes out without an icon, and the upload that finishes later serves the next post without a second upload.
  it("posts without an icon while a slow upload finishes", async () => {
    let answer: (res: Response) => void = () => {};
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Promise<Response>((resolve) => (answer = resolve));
    }) as unknown as typeof fetch;
    const icons = createImgbbAgentIcons("secret", fetchImpl, 5);

    expect(await icons("lens")).toBeNull();
    answer(ok());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await icons("lens")).toBe(ICON);
    expect(calls).toBe(1);
  });
});
