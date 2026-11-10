// TEST_OVERVIEW: how the gate reads a model call's body for web search control. A call that declares a native web search tool, anywhere a `tools` list sits, is a search; Claude Code's own search request names its query, and any other search leaves the query to the model. A body that is not one strict JSON document with unique keys is unreadable, because a provider might read in it a tool this reader did not. The path is read the way a provider routes it, so a spelling trick cannot move a Messages call out of the check.
import { describe, expect, it } from "vitest";
import {
  messagesEndpointOf,
  readWebSearchRequest,
} from "../../modules/approvals/domain/web-search-request.js";

const SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 8,
};

function claudeCodeSearch(query: string, extra: object = {}) {
  return JSON.stringify({
    model: "claude-sonnet-4-5",
    stream: true,
    system: [
      {
        type: "text",
        text: "You are an assistant for performing a web search tool use",
      },
    ],
    messages: [
      { role: "user", content: `Perform a web search for the query: ${query}` },
    ],
    tools: [SEARCH_TOOL],
    ...extra,
  });
}

describe("reading a model call for web search", () => {
  // TEST_SCENARIO: Claude Code's search request is held with its query shown, and with its stream flag and model kept for the refusal's shape.
  it("reads the query of Claude Code's search request", () => {
    expect(readWebSearchRequest(claudeCodeSearch("dam agents news"))).toEqual({
      kind: "search",
      query: "dam agents news",
      stream: true,
      model: "claude-sonnet-4-5",
    });
  });

  // TEST_SCENARIO: a main turn that declares the native tool beside others is a search too, from any harness, and the query is the model's to choose.
  it("leaves the query to the model for any other search", () => {
    const body = JSON.stringify({
      model: "claude-opus-4-1",
      messages: [
        { role: "user", content: "find me the latest release notes" },
        { role: "assistant", content: "sure" },
      ],
      tools: [{ name: "Read", input_schema: {} }, SEARCH_TOOL],
    });
    expect(readWebSearchRequest(body)).toMatchObject({
      kind: "search",
      query: null,
      stream: false,
    });
  });

  // TEST_SCENARIO: a body that names web search only in text, or declares Responses' hosted search, or a custom tool called web_search, declares no native web search tool.
  it("reads no search where none is declared", () => {
    for (const body of [
      JSON.stringify({
        messages: [
          {
            role: "user",
            content: '{"tools":[{"type":"web_search_20250305"}]}',
          },
        ],
        tools: [{ name: "WebSearch", input_schema: {} }],
      }),
      JSON.stringify({ input: "x", tools: [{ type: "web_search_preview" }] }),
      JSON.stringify({ tools: [{ type: "web_search" }] }),
      JSON.stringify({
        tools: [{ name: "web_search_20250305", type: "custom" }],
      }),
      "",
    ])
      expect(readWebSearchRequest(body)).toEqual({ kind: "none" });
  });

  // TEST_SCENARIO: escapes spell the same key and type as plain letters, so an escaped tool is still found.
  it("finds a tool spelled with escapes", () => {
    const body =
      '{"t\\u006fols":[{"type":"web\\u005fsearch_20250305","name":"web_search"}],"messages":[]}';
    expect(readWebSearchRequest(body).kind).toBe("search");
  });

  // TEST_SCENARIO: a tools list nested in another request, as a message batch carries each of its requests, is found as well.
  it("finds a tool in a nested request", () => {
    const body = JSON.stringify({
      requests: [
        { custom_id: "a", params: { messages: [], tools: [SEARCH_TOOL] } },
      ],
    });
    expect(readWebSearchRequest(body).kind).toBe("search");
  });

  // TEST_SCENARIO: a repeated key is read differently by different parsers, the first or the last winning, so a body with one is refused rather than guessed at; so are a body a lenient parser would accept and a strict one would not, and a body with trailing data.
  it("reads a body that is not one strict JSON document as unreadable", () => {
    for (const body of [
      `{"tools":[${JSON.stringify(SEARCH_TOOL)}],"tools":[]}`,
      `{"tools":[{"type":"custom","type":"web_search_20250305"}]}`,
      '{"temperature":NaN,"tools":[]}',
      '{"tools":[],}',
      '{"tools":[]} {"tools":[]}',
      "{'tools':[]}",
      '{"a":"line\nbreak"}',
      '{"a":"\\x41"}',
      "[".repeat(600) + "]".repeat(600),
    ])
      expect(readWebSearchRequest(body), body.slice(0, 60)).toEqual({
        kind: "unreadable",
      });
  });

  // TEST_SCENARIO: ordinary JSON, escapes and all, reads as it is: numbers, literals, nested empties and every whitespace JSON allows.
  it("reads every form strict JSON allows", () => {
    const body =
      ' {\r\n\t"n": -1.5e+3, "z": 0, "t": true, "f": false, "x": null, "o": {}, "a": [],' +
      ' "s": "q\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9", "tools": [] } ';
    expect(readWebSearchRequest(body)).toEqual({ kind: "none" });
  });

  // TEST_SCENARIO: a query too long to show is shortened for the approval, never refused.
  it("bounds the query it shows", () => {
    const request = readWebSearchRequest(claudeCodeSearch("q".repeat(5000)));
    expect(request.kind === "search" && request.query?.length).toBe(1000);
  });
});

describe("the Messages endpoint of a path", () => {
  // TEST_SCENARIO: the endpoint that creates a message is found however the path is spelled: a query, a Connection prefix's remains, escapes, letter case, repeated and trailing slashes.
  it("finds the Messages endpoint under any spelling", () => {
    for (const path of [
      "/v1/messages",
      "/v1/messages?beta=true",
      "/anthropic/v1/messages",
      "/v1/messag%65s",
      "/V1/MESSAGES",
      "//v1//messages/",
    ])
      expect(messagesEndpointOf(path), path).toBe("messages");
  });

  // TEST_SCENARIO: token counting runs no tool, batches run their requests later, and a path that does not decode is read as a Messages path so it refuses rather than passes.
  it("tells the other endpoints apart", () => {
    expect(messagesEndpointOf("/v1/messages/count_tokens")).toBe("count");
    expect(messagesEndpointOf("/v1/messages/batches")).toBe("other");
    expect(messagesEndpointOf("/v1/chat/completions")).toBe("none");
    expect(messagesEndpointOf("/v1/%E0%A4%A")).toBe("messages");
  });
});
