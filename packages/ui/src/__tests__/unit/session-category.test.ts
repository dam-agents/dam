import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  sessionCategory,
  slackSessionKind,
} from "../../modules/sessions/lib/session-category.js";

const session = (over: Partial<SessionView>): SessionView => ({
  sessionId: "s1",
  agentId: "a1",
  type: SessionType.Regular,
  mode: SessionMode.Chat,
  createdAt: "2026-07-24T00:00:00.000Z",
  ...over,
});

describe("sessionCategory", () => {
  test("terminal mode wins over type", () => {
    expect(sessionCategory(session({ mode: SessionMode.Terminal }))).toBe(
      "terminal",
    );
  });

  test("both channel types land in channels", () => {
    expect(sessionCategory(session({ type: SessionType.ChannelSlack }))).toBe(
      "channels",
    );
    expect(
      sessionCategory(session({ type: SessionType.ChannelTelegram })),
    ).toBe("channels");
  });

  test("cron is scheduled, regular is chats", () => {
    expect(sessionCategory(session({ type: SessionType.ScheduleCron }))).toBe(
      "scheduled",
    );
    expect(sessionCategory(session({ type: SessionType.Regular }))).toBe(
      "chats",
    );
  });
});

describe("slackSessionKind", () => {
  test("an ambient-keyed Slack session is the ambient reader", () => {
    expect(
      slackSessionKind(
        session({
          type: SessionType.ChannelSlack,
          threadTs: "ambient:C123",
        }),
      ),
    ).toBe("ambient");
  });

  test("a numeric thread_ts Slack session is a thread", () => {
    expect(
      slackSessionKind(
        session({
          type: SessionType.ChannelSlack,
          threadTs: "1700000005.000100",
        }),
      ),
    ).toBe("thread");
  });

  test("a Slack session with no thread key is a thread, not ambient", () => {
    expect(slackSessionKind(session({ type: SessionType.ChannelSlack }))).toBe(
      "thread",
    );
  });

  test("ambient is Slack-only: Telegram never reads as ambient", () => {
    // Even if a Telegram conversation id somehow carried the prefix, it is not
    // a Slack channel session, so the ambient split does not apply.
    expect(
      slackSessionKind(
        session({
          type: SessionType.ChannelTelegram,
          threadTs: "ambient:C123",
        }),
      ),
    ).toBe(null);
  });

  test("non-channel sessions have no Slack kind", () => {
    expect(slackSessionKind(session({ type: SessionType.Regular }))).toBe(null);
    expect(slackSessionKind(session({ type: SessionType.ScheduleCron }))).toBe(
      null,
    );
  });
});
