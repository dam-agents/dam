// TEST_OVERVIEW: which chat form surfaces accept input — a form stays answerable after a later agent reply with no form, and locks once the user answers it or answers a newer form.
import { A2UI_BASIC_CATALOG_ID as BASIC_CATALOG_ID } from "api-server-api/chat-forms";
import { describe, expect, test } from "vitest";

import { buildConversation } from "../../modules/a2ui/lib/build-conversation.js";
import { collectBlocks } from "../../modules/a2ui/lib/collect-blocks.js";
import { openSurfaceIds } from "../../modules/a2ui/lib/open-surfaces.js";
import { formatRendererMessage } from "../../modules/a2ui/lib/prompts.js";
import type { Message } from "../../types.js";

function form(surfaceId: string): string {
  const block = JSON.stringify({
    version: "v1.0",
    createSurface: {
      surfaceId,
      catalogId: BASIC_CATALOG_ID,
      components: [
        {
          id: "root",
          component: "Button",
          child: "label",
          action: { event: { name: "go" } },
        },
        { id: "label", component: "Text", text: "Go" },
      ],
    },
  });
  return `Pick one:\n<a2ui-json>\n${block}\n</a2ui-json>`;
}

function reply(id: string, text: string): Message {
  return {
    id,
    role: "assistant",
    parts: [{ kind: "text", text }],
    streaming: false,
  };
}

function answer(id: string, surfaceId: string): Message {
  const text = formatRendererMessage({
    version: "v1.0",
    action: {
      name: "go",
      surfaceId,
      sourceComponentId: "root",
      timestamp: "2026-10-27T10:00:00.000Z",
      context: {},
    },
  });
  return {
    id,
    role: "user",
    parts: [{ kind: "text", text }],
    streaming: false,
  };
}

function open(messages: Message[]): string[] {
  const last = messages.at(-1);
  const live = last?.role === "assistant" ? last.id : null;
  const conversation = buildConversation(collectBlocks(messages));
  return [...openSurfaceIds(conversation, messages, live)];
}

describe("chat form surfaces that accept input", () => {
  // TEST_SCENARIO: the agent sends a form, then a status reply with no form before the user answers; the form must stay answerable so the user does not have to ask in text.
  test("an unanswered form stays open after a later reply with no form", () => {
    expect(
      open([reply("a1", form("ask")), reply("a2", "The build finished.")]),
    ).toEqual(["ask"]);
  });

  // TEST_SCENARIO: once the user sends a form, a later reply must not open it again, as before.
  test("a form the user answered stays locked", () => {
    expect(
      open([
        reply("a1", form("ask")),
        answer("u1", "ask"),
        reply("a2", "Thanks, applied."),
      ]),
    ).toEqual([]);
  });

  // TEST_SCENARIO: two unanswered forms are in the conversation and the user answers the newer one; the agent has moved past the older one, so it locks too.
  test("answering a newer form locks the older one", () => {
    const both = [reply("a1", form("first")), reply("a2", form("second"))];
    expect(open(both)).toEqual(["first", "second"]);
    expect(
      open([...both, answer("u1", "second"), reply("a3", "Done.")]),
    ).toEqual([]);
  });

  // TEST_SCENARIO: answering an older form leaves a newer one open, because the newer question is still waiting.
  test("answering an older form leaves a newer one open", () => {
    expect(
      open([
        reply("a1", form("first")),
        reply("a2", form("second")),
        answer("u1", "first"),
        reply("a3", "Noted."),
      ]),
    ).toEqual(["second"]);
  });

  // TEST_SCENARIO: while the user's message is the newest, the agent has not answered yet, so no form accepts input, as before.
  test("no form is open while the newest message is the user's", () => {
    expect(open([reply("a1", form("ask")), answer("u1", "other")])).toEqual([]);
  });
});
