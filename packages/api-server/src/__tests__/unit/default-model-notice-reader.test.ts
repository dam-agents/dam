// TEST_OVERVIEW: The default-model notice reader asks the database which Agents run unattended. It must count a Slack Channel bound in `channels` and a Telegram chat bound in `telegram_conversations` — the table the Telegram bind flow actually writes — and it must read only what decides the answer: an enabled Schedule, one Slack binding, one Telegram binding. These specs write through the real binding repositories and read through the real reader, so a binding stored in a table the reader does not query fails them.
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import type { Db } from "db";
import {
  bindConversation,
  unbindConversation,
} from "../../modules/channels/infrastructure/telegram-conversations-repository.js";
import { createDefaultModelNoticeReader } from "../../modules/harness-config/infrastructure/default-model-notices.js";

const OWNER = "kc|owner-1";
const AGENT = "agent-1";

type World = {
  telegram: { conversationId: string; agentId: string }[];
  slack: { agentId: string }[];
  schedules: { agentId: string; enabled: boolean }[];
};

function world(initial: Partial<World> = {}) {
  const w: World = {
    telegram: [],
    slack: [],
    schedules: [],
    ...initial,
  };
  const db = drizzle(async (sql, params) => {
    if (sql.startsWith('insert into "telegram_conversations"')) {
      w.telegram.push({
        conversationId: String(params[0]),
        agentId: String(params[1]),
      });
      return { rows: [[params[0]]] };
    }
    if (sql.startsWith('delete from "telegram_conversations"')) {
      w.telegram = w.telegram.filter((r) => r.conversationId !== params[0]);
      return { rows: [] };
    }
    if (sql.includes('from "agents"'))
      return {
        rows: [
          [
            AGENT,
            { harness: "claude-code", provider: "anthropic", model: null },
            null,
            { modelRouter: true },
          ],
        ],
      };
    if (sql.includes('from "connection_grants"'))
      return { rows: [[AGENT, "anthropic"]] };
    if (sql.includes('from "schedules"'))
      return {
        rows: w.schedules
          .filter((r) => r.agentId === params[0] && r.enabled)
          .map((r) => [r.agentId]),
      };
    if (sql.includes('from "channels"'))
      return { rows: w.slack.map((r) => [r.agentId]) };
    if (sql.includes('from "telegram_conversations"'))
      return { rows: w.telegram.map((r) => [r.agentId]) };
    throw new Error(`unexpected query: ${sql}`);
  });
  return { ...w, db: db as unknown as Db };
}

const noticeStateOf = async (db: Db, agentIds: readonly string[] = [AGENT]) =>
  (await createDefaultModelNoticeReader(db)(agentIds))[0]?.state ?? null;

const CHAT = `telegram:${AGENT}:chat-42`;

describe("the default-model notice reader", () => {
  // TEST_SCENARIO: a Telegram chat is the Agent's only unattended run. The bind flow stores it in `telegram_conversations`, so a reader that looks for Telegram rows in `channels` sees nothing and the owner is never told its channel turns cannot run.
  it("counts a Telegram binding stored by the bind flow", async () => {
    const { db } = world();
    expect(await noticeStateOf(db)).toBeNull();

    expect(await bindConversation(db)(CHAT, AGENT, OWNER)).toBe("bound");
    expect(await noticeStateOf(db)).toBe("not-set");
  });

  // TEST_SCENARIO: removing the last binding ends the run the notice names, so the notice goes with it; the same reader call must answer null again.
  it("drops the notice when the last Telegram binding goes", async () => {
    const { db } = world();
    await bindConversation(db)(CHAT, AGENT, OWNER);
    expect(await noticeStateOf(db)).toBe("not-set");

    await unbindConversation(db)(CHAT);
    expect(await noticeStateOf(db)).toBeNull();
  });

  // TEST_SCENARIO: a Slack Channel stays in `channels`, so the reader must still count it there; a Schedule that is switched off is no run at all, while one that is on is.
  it("counts a Slack binding and an enabled Schedule, not a disabled one", async () => {
    expect(await noticeStateOf(world({ slack: [{ agentId: AGENT }] }).db)).toBe(
      "not-set",
    );
    expect(
      await noticeStateOf(
        world({ schedules: [{ agentId: AGENT, enabled: false }] }).db,
      ),
    ).toBeNull();
    expect(
      await noticeStateOf(
        world({ schedules: [{ agentId: AGENT, enabled: true }] }).db,
      ),
    ).toBe("not-set");
  });

  // TEST_SCENARIO: the notice is per Agent, so a binding on another Agent must not put a notice on this one.
  it("keeps one Agent's bindings off another", async () => {
    const { db } = world({
      telegram: [{ conversationId: "telegram:other:chat-1", agentId: "other" }],
    });
    expect(await noticeStateOf(db)).toBeNull();
  });
});
