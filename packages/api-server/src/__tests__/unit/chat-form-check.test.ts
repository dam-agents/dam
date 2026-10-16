// TEST_OVERVIEW: check_chat_form validates an agent's chat form the way the web chat replays it, reports forms that go against the agent's chat form preferences, and after the third failed attempt tells the agent to ask in plain text.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import {
  A2UI_CHAT_EXTENSION_ID,
  A2UI_PLATFORM_CATALOG_ID,
  checkChatForm,
  DEFAULT_CHAT_FORM_PREFERENCES,
  type ChatFormPreferences,
} from "api-server-api/chat-forms";
import { registerChatFormTools } from "../../modules/chat-forms/index.js";

function block(messages: unknown[]): string {
  return `Pick one:\n<a2ui-json>\n${JSON.stringify(messages)}\n</a2ui-json>`;
}

const LOCKED_WITHOUT_BUTTON = block([
  {
    version: "v1.0",
    createSurface: {
      surfaceId: "pick",
      catalogId: A2UI_PLATFORM_CATALOG_ID,
      metadata: {
        extensions: { [A2UI_CHAT_EXTENSION_ID]: { lockComposer: true } },
      },
      components: [
        { id: "root", component: "Text", text: "Hi" },
        {
          id: "orphan",
          component: "Button",
          child: "label",
          action: { event: { name: "go" } },
        },
        { id: "label", component: "Text", text: "Go" },
      ],
    },
  },
]);

const TWO_QUESTIONS_LOCKED = block([
  {
    version: "v1.0",
    createSurface: {
      surfaceId: "setup",
      catalogId: A2UI_PLATFORM_CATALOG_ID,
      metadata: {
        extensions: { [A2UI_CHAT_EXTENSION_ID]: { lockComposer: true } },
      },
      components: [
        { id: "root", component: "Column", children: ["cadence", "on", "go"] },
        {
          id: "cadence",
          component: "ChoicePicker",
          options: [{ label: "Weekly (Recommended)", value: "weekly" }],
          value: { "@path": "/cadence" },
        },
        { id: "on", component: "Switch", label: "Notify", value: true },
        {
          id: "go",
          component: "Button",
          child: "label",
          action: { event: { name: "save" } },
        },
        { id: "label", component: "Text", text: "Save" },
      ],
    },
  },
]);

async function client(
  preferences: ChatFormPreferences = DEFAULT_CHAT_FORM_PREFERENCES,
) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerChatFormTools(server, preferences);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await mcp.connect(clientSide);
  return mcp;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { text: string }[])[0]?.text ?? "";
}

describe("check_chat_form", () => {
  // TEST_SCENARIO: a surface that locks the composer must render a Button with an event from root, so one no component lists does not count, and an update to a surface an earlier reply created is checked without asking for createSurface.
  it("reports a locked form whose answer button is not rendered and accepts an update to an earlier surface", () => {
    const locked = checkChatForm(LOCKED_WITHOUT_BUTTON);
    expect(locked.ok).toBe(false);
    expect(locked.problems.map((problem) => problem.message)).toEqual([
      'Surface "pick" locks the composer but renders no Button with an event action, so the user could not answer.',
    ]);
    const update = checkChatForm(
      JSON.stringify({
        version: "v1.0",
        updateComponents: {
          surfaceId: "earlier",
          components: [{ id: "note", component: "Text", text: "Saved" }],
        },
      }),
    );
    expect(update).toEqual({
      ok: true,
      surfaces: [{ surfaceId: "earlier", created: false, lockComposer: false }],
      problems: [],
    });
  });

  // TEST_SCENARIO: with one question per form, no recommendations and no input lock, the tool reports each of them on a form the defaults accept.
  it("reports a form that goes against the agent's chat form preferences", async () => {
    expect(checkChatForm(TWO_QUESTIONS_LOCKED).ok).toBe(true);
    const mcp = await client({
      forms: "input",
      pacing: "one-at-a-time",
      recommend: "off",
      lockComposer: false,
    });
    const result = await mcp.callTool({
      name: "check_chat_form",
      arguments: { reply: TWO_QUESTIONS_LOCKED, attempt: 1 },
    });
    const { ok, problems } = JSON.parse(text(result)) as {
      ok: boolean;
      problems: { code: string; message: string }[];
    };
    expect(ok).toBe(false);
    expect(problems.map((problem) => problem.code)).toEqual([
      "USER_PREFERENCE",
      "USER_PREFERENCE",
      "USER_PREFERENCE",
    ]);
    expect(problems.map((problem) => problem.message).join("\n")).toMatch(
      /one question per form[\s\S]*recommendations[\s\S]*Remove lockComposer/,
    );
  });

  // TEST_SCENARIO: the third failed check tells the agent to ask in plain text, and a fourth attempt is refused.
  it("sends the agent to plain text after the third failed attempt", async () => {
    const mcp = await client();
    const second = await mcp.callTool({
      name: "check_chat_form",
      arguments: { reply: LOCKED_WITHOUT_BUTTON, attempt: 2 },
    });
    expect(JSON.parse(text(second)).next).toContain("attempt 3");
    const third = await mcp.callTool({
      name: "check_chat_form",
      arguments: { reply: LOCKED_WITHOUT_BUTTON, attempt: 3 },
    });
    expect(JSON.parse(text(third)).next).toContain("plain text");
    const fourth = await mcp.callTool({
      name: "check_chat_form",
      arguments: { reply: LOCKED_WITHOUT_BUTTON, attempt: 4 },
    });
    expect(fourth.isError).toBe(true);
    expect(text(fourth)).toContain("plain text");
  });
});
