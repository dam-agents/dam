// TEST_OVERVIEW: With the chat:write.customize scope, an agent's Slack posts carry the agent's name as username and its avatar as icon_url, so a channel with several agents shows who said what. Without the scope, or when the granted set is unknown, posts go out under the app's own identity and open with an emoji and the agent's name in bold instead. The emoji is the agent's emoji avatar, else the custom emoji the connection names for the agent's character, and the robot face when the connection names none. The icon is the agent's chosen avatar, or the character picked from its owner and name when none is chosen. An emoji avatar links the public Twemoji PNG and is never uploaded; an uploaded image is read from the store and uploaded like a character. Each character is uploaded to ImgBB once per install, as a PNG named by a hash: its URL is stored under the SHA-256 of the PNG, so a restart or another replica reuses it. All characters are uploaded at startup, a failed upload is retried after a minute, and a post that goes out without the icon is logged.
import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  AVATAR_CHARACTERS,
  type Avatar,
  avatarCharacter,
} from "api-server-api/avatar/svg";
import type { AgentsService } from "api-server-api";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { configureLogger } from "../../core/logger.js";
import type { AcpClient } from "../../core/acp-client.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import {
  type AgentIconUrl,
  createImgbbAgentIcons,
  twemojiUrl,
} from "../../modules/channels/infrastructure/agent-avatar-icons.js";
import type { PublicImageUrls } from "../../modules/channels/infrastructure/public-image-urls-repository.js";
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
  customEmoji?: string[],
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
      resolveSlackChannelsByInstance: async () => [
        { id: BOUND, teamId: "", customEmoji },
      ],
    },
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    agentsFor: () => ({}) as never,
    ignoredApps: {
      list: async () => [],
      ignore: async () => true,
      unignore: async () => true,
    },
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
    gw,
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
    const seen: Avatar[] = [];
    const icon: AgentIconUrl = async (avatar) => {
      seen.push(avatar);
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

    expect(post).toMatchObject({
      username: "Scout",
      iconUrl: ICON,
      text: "hello",
    });
    expect(reply).toMatchObject({ username: "Scout", iconUrl: ICON });
    const hashed = {
      kind: "character",
      character: avatarCharacter(undefined, OWNER, "Scout"),
    };
    expect(seen).toEqual([hashed, hashed]);
  });

  // TEST_SCENARIO: A character the owner chose wins over the one picked from the name, so Slack shows the same character as the UI.
  it("shows the agent's chosen character", async () => {
    const seen: Avatar[] = [];
    const icon: AgentIconUrl = async (avatar) => {
      seen.push(avatar);
      return ICON;
    };
    const chosen =
      avatarCharacter(undefined, OWNER, "Scout") === "lens" ? "wave" : "lens";

    await harness(["chat:write.customize"], icon, chosen).post();

    expect(seen).toEqual([{ kind: "character", character: chosen }]);
  });

  // TEST_SCENARIO: An emoji or an uploaded image the owner chose reaches the icon lookup as itself, not as a character.
  it("passes an emoji or image avatar to the icon lookup", async () => {
    const seen: Avatar[] = [];
    const icon: AgentIconUrl = async (avatar) => {
      seen.push(avatar);
      return ICON;
    };
    const id = "a".repeat(64);
    await harness(["chat:write.customize"], icon, "emoji:🦊").post();
    await harness(["chat:write.customize"], icon, `image:${id}`).post();
    expect(seen).toEqual([
      { kind: "emoji", emoji: "🦊" },
      { kind: "image", id },
    ]);
  });

  // TEST_SCENARIO: Without the scope an emoji avatar signs the post itself, in place of the character's custom emoji or the robot face.
  it("signs the post with the agent's emoji avatar", async () => {
    const names = Array.from({ length: 8 }, (_, i) => `team-agent-${i + 1}`);
    const post = await harness(["chat:write"], null, "emoji:🦊", names).post();
    expect(post).toMatchObject({ text: "🦊 *Scout*\n\nhello" });
  });

  // TEST_SCENARIO: Without the scope Slack may refuse or ignore the override, and with an unknown granted set nothing proves it is allowed, so the post keeps the app's identity.
  it("keeps the app's identity when the scope is withheld or unknown", async () => {
    for (const scopes of [["chat:write"], null]) {
      const message = await harness(scopes, async () => ICON).post();
      expect(message).not.toHaveProperty("username");
      expect(message).not.toHaveProperty("iconUrl");
    }
  });

  // TEST_SCENARIO: The connection names custom emoji, so the post opens with the one for the agent's character and the bold name, on both the notification text and the rendered block. The names are listed in the order the emoji set was drawn, not the order of the characters.
  it("signs the post with the custom emoji the connection names for the character", async () => {
    const names = Array.from({ length: 8 }, (_, i) => `team-agent-${i + 1}`);
    const h = harness(["chat:write"], null, "spark", names);
    const posted = vi.spyOn(h.gw, "postMessage");
    const post = await h.post();
    expect(post).toMatchObject({ text: ":team-agent-5: *Scout*\n\nhello" });
    expect(post).not.toHaveProperty("username");
    expect(posted.mock.calls[0]![0].blocks![0]).toEqual({
      type: "markdown",
      text: ":team-agent-5: **Scout**\n\nhello",
    });

    const reply = await harness(["chat:write"], null, "compass", names).reply();
    expect(reply).toMatchObject({ text: ":team-agent-1: *Scout*\n\nhi" });
  });

  // TEST_SCENARIO: The connection names no custom emoji, or the granted set is unknown and the connection names none, so the post opens with the robot face.
  it("signs the post with the robot face when the connection names no emoji", async () => {
    for (const scopes of [["chat:write"], null]) {
      const message = await harness(scopes, null, "spark").post();
      expect(message).toMatchObject({ text: ":robot_face: *Scout*\n\nhello" });
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

  // TEST_SCENARIO: The image host is configured but gives no URL in time, so the post goes out with the app's icon, and a warning names the agent and character so the gap can be counted.
  it("logs a post that goes out without the agent's icon", async () => {
    const lines: string[] = [];
    configureLogger({ level: "warn", write: (line) => lines.push(line) });
    try {
      await harness(["chat:write.customize"], async () => null, "spark").post();
      await harness(["chat:write.customize"], async () => ICON).post();
    } finally {
      configureLogger({ level: "error", write: () => {} });
    }
    const missing = lines
      .map((l) => JSON.parse(l))
      .filter((r) => r.msg === "slack.agent_icon.missing");
    expect(missing).toEqual([
      expect.objectContaining({ agentId: "agent-1", avatar: "character" }),
    ]);
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
  function memoryStore(): PublicImageUrls & { rows: Map<string, string> } {
    const rows = new Map<string, string>();
    return {
      rows,
      get: async (sha256) => rows.get(sha256) ?? null,
      put: async (sha256, url) => {
        if (!rows.has(sha256)) rows.set(sha256, url);
      },
    };
  }
  const ok = () => Response.json({ data: { url: ICON } });

  // TEST_SCENARIO: The first post with a character uploads its PNG under a hashed filename and stores the URL under the PNG's SHA-256; later posts with that character reuse the URL, and another character gets its own upload.
  it("uploads a hashed PNG once per character and stores its URL", async () => {
    const imgbb = fakeImgbb([ok, ok]);
    const store = memoryStore();
    const { iconUrl } = createImgbbAgentIcons({
      apiKey: "secret",
      store,
      loadImage: async () => null,
      fetchImpl: imgbb.fetchImpl,
    });

    expect(await iconUrl({ kind: "character", character: "lens" })).toBe(ICON);
    expect(await iconUrl({ kind: "character", character: "lens" })).toBe(ICON);
    expect(imgbb.uploads).toHaveLength(1);
    expect(await iconUrl({ kind: "character", character: "wave" })).toBe(ICON);

    expect(imgbb.uploads).toHaveLength(2);
    const form = imgbb.uploads[0]!;
    expect(form.get("key")).toBe("secret");
    const image = form.get("image") as File;
    expect(image.type).toBe("image/png");
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(image.name).toBe(`${sha256.slice(0, 16)}.png`);
    expect(store.rows.get(sha256)).toBe(ICON);
    expect(store.rows.size).toBe(2);
  });

  // TEST_SCENARIO: An uploaded image is read from the store and uploaded as it is; an image the store does not hold gives no icon.
  it("uploads an uploaded image from the store", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const imgbb = fakeImgbb([ok]);
    const { iconUrl } = createImgbbAgentIcons({
      apiKey: "secret",
      store: memoryStore(),
      loadImage: async (id) => (id === "img1" ? png : null),
      fetchImpl: imgbb.fetchImpl,
    });
    expect(await iconUrl({ kind: "image", id: "img1" })).toBe(ICON);
    const sent = imgbb.uploads[0]!.get("image") as File;
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(png);
    expect(await iconUrl({ kind: "image", id: "missing" })).toBeNull();
    expect(imgbb.uploads).toHaveLength(1);
  });

  // TEST_SCENARIO: An emoji avatar links the Twemoji PNG named by its code points and uploads nothing. U+FE0F is dropped unless the emoji is a ZWJ sequence, the way Twemoji names its files.
  it("links Twemoji for an emoji without uploading", async () => {
    const imgbb = fakeImgbb([]);
    const { iconUrl } = createImgbbAgentIcons({
      apiKey: "secret",
      store: memoryStore(),
      loadImage: async () => null,
      fetchImpl: imgbb.fetchImpl,
    });
    expect(await iconUrl({ kind: "emoji", emoji: "🦊" })).toMatch(
      /\/1f98a\.png$/,
    );
    expect(twemojiUrl("❤️")).toMatch(/\/2764\.png$/);
    expect(twemojiUrl("👩‍💻")).toMatch(/\/1f469-200d-1f4bb\.png$/);
    expect(imgbb.uploads).toHaveLength(0);
  });

  // TEST_SCENARIO: After a restart, or on another replica, the stored URL answers the post and ImgBB is not called again.
  it("reuses a stored URL across processes without uploading", async () => {
    const store = memoryStore();
    const first = fakeImgbb([ok]);
    await createImgbbAgentIcons({
      apiKey: "secret",
      store,
      loadImage: async () => null,
      fetchImpl: first.fetchImpl,
    }).iconUrl({ kind: "character", character: "lens" });

    const second = fakeImgbb([]);
    const { iconUrl } = createImgbbAgentIcons({
      apiKey: "secret",
      store,
      loadImage: async () => null,
      fetchImpl: second.fetchImpl,
    });
    expect(await iconUrl({ kind: "character", character: "lens" })).toBe(ICON);
    expect(second.uploads).toHaveLength(0);
  });

  // TEST_SCENARIO: Postgres failing to read or write the URL must not cost the post its icon: the upload still serves it.
  it("still uploads when the URL store fails", async () => {
    const imgbb = fakeImgbb([ok]);
    const broken: PublicImageUrls = {
      get: async () => {
        throw new Error("db down");
      },
      put: async () => {
        throw new Error("db down");
      },
    };
    const { iconUrl } = createImgbbAgentIcons({
      apiKey: "secret",
      store: broken,
      loadImage: async () => null,
      fetchImpl: imgbb.fetchImpl,
    });
    expect(await iconUrl({ kind: "character", character: "lens" })).toBe(ICON);
    expect(imgbb.uploads).toHaveLength(1);
  });

  // TEST_SCENARIO: warm() at startup resolves every character, so the first post of each finds its URL ready and nothing is uploaded at post time.
  it("warms every character before the first post", async () => {
    const imgbb = fakeImgbb(AVATAR_CHARACTERS.map(() => ok));
    const icons = createImgbbAgentIcons({
      apiKey: "secret",
      store: memoryStore(),
      loadImage: async () => null,
      fetchImpl: imgbb.fetchImpl,
      waitMs: 0,
    });
    await icons.warm();
    expect(imgbb.uploads).toHaveLength(AVATAR_CHARACTERS.length);

    for (const character of AVATAR_CHARACTERS)
      expect(await icons.iconUrl({ kind: "character", character })).toBe(ICON);
    expect(imgbb.uploads).toHaveLength(AVATAR_CHARACTERS.length);
  });

  // TEST_SCENARIO: A failed upload answers null and is remembered, so the next posts don't pay for another attempt; after RETRY_AFTER_MS (one minute) the upload is tried again.
  it("remembers a failed upload for a minute, then retries", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const imgbb = fakeImgbb([
        () => new Response("down", { status: 503 }),
        () => Response.json({ data: { url: "http://not-https" } }),
        ok,
      ]);
      const { iconUrl } = createImgbbAgentIcons({
        apiKey: "secret",
        store: memoryStore(),
        loadImage: async () => null,
        fetchImpl: imgbb.fetchImpl,
      });

      expect(
        await iconUrl({ kind: "character", character: "lens" }),
      ).toBeNull();
      expect(
        await iconUrl({ kind: "character", character: "lens" }),
      ).toBeNull();
      expect(imgbb.uploads).toHaveLength(1);

      vi.advanceTimersByTime(60_000);
      expect(
        await iconUrl({ kind: "character", character: "lens" }),
      ).toBeNull();
      vi.advanceTimersByTime(60_000);
      expect(await iconUrl({ kind: "character", character: "lens" })).toBe(
        ICON,
      );
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
    const { iconUrl } = createImgbbAgentIcons({
      apiKey: "secret",
      store: memoryStore(),
      loadImage: async () => null,
      fetchImpl,
      waitMs: 5,
    });

    expect(await iconUrl({ kind: "character", character: "lens" })).toBeNull();
    answer(ok());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await iconUrl({ kind: "character", character: "lens" })).toBe(ICON);
    expect(calls).toBe(1);
  });
});
