// TEST_OVERVIEW: Telegram has no artifact page behind a sign-in, so the link rule keeps its plain shape there: a public artifact's link goes out as its share URL, and a private one refuses the message, which is posted in no form. Both are applied where the message is sent, on the text the agent wrote.
import type { TelegramUser } from "@chat-adapter/telegram";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureLogger } from "../../core/logger.js";
import type { ChannelSendResult } from "../../modules/channels/services/channel-manager.js";
import {
  telegramWorkerHarness,
  type StubArtifact,
} from "../helpers/telegram-worker.js";

configureLogger({ level: "error", write: () => {} });

const PRIVATE = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const PUBLIC = "0b6f6a52-5d0e-4a4e-9b1e-1f0c2a3b4c5d";
const artifacts: StubArtifact[] = [
  { id: PRIVATE, title: "Draft plan", shareUrl: null },
  {
    id: PUBLIC,
    title: "Weekly report",
    shareUrl: "https://share.example/a/weekly-report",
  },
];

const JANE: TelegramUser = {
  id: 7,
  is_bot: false,
  first_name: "Jane",
  username: "jane",
};

let stop: () => Promise<void> = async () => {};

afterEach(async () => {
  await stop();
  vi.unstubAllGlobals();
});

async function posted(
  text: string,
  harnessOpts: Parameters<typeof telegramWorkerHarness>[0] = {},
) {
  const results: ChannelSendResult[] = [];
  const worker: { post?: (text: string) => Promise<ChannelSendResult> } = {};
  const h = telegramWorkerHarness({
    artifacts,
    ...harnessOpts,
    turn: async () => {
      results.push(await worker.post!(text));
    },
  });
  worker.post = (value) => h.worker.postMessage("agent-1", value);
  vi.stubGlobal("fetch", h.botApi);
  await h.worker.start();
  stop = () => h.worker.stopAll();
  h.sendDirect(JANE, "hello");
  await vi.waitFor(() => expect(results).toHaveLength(1));
  return { posted: results[0]!, posts: h.posts };
}

describe("a Telegram message with no artifact link", () => {
  /**
   * TEST_SCENARIO: The owner is read only to look up the artifacts a message
   * links, so a plain message is sent without it: a lookup that fails for
   * another reason cannot take an ordinary post down.
   */
  it("posts without asking who the owner is", async () => {
    const h = await posted("just a note", {
      ownerOf: async () => {
        throw new Error("owner lookup unavailable");
      },
    });

    expect(h.posted).toMatchObject({ ok: true });
    expect(h.posts).toEqual(["just a note"]);
  });
});

describe("a private artifact's link in a Telegram message", () => {
  // TEST_SCENARIO: a private artifact has no link that opens outside the app, and Telegram has no owner's-DM exception, so the message is refused and nothing reaches the chat.
  it("refuses the message and posts nothing", async () => {
    const h = await posted(`Draft: platform://artifacts/${PRIVATE}`);

    expect(h.posted).toMatchObject({
      error: expect.stringContaining("must be shared from the app"),
    });
    expect(h.posts).toEqual([]);
  });

  // TEST_SCENARIO: a public artifact's link goes out as its share URL, in the same message.
  it("posts a public artifact's share URL in its place", async () => {
    const h = await posted(`Report: platform://artifacts/${PUBLIC}`);

    expect(h.posted).toMatchObject({ ok: true });
    expect(h.posts).toEqual(["Report: https://share.example/a/weekly-report"]);
  });
});
