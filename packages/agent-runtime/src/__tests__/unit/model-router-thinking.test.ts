/**
 * TEST_OVERVIEW: A Claude model checks the signature of every thinking block
 * in a Messages history and refuses the whole call for one another model
 * wrote. The Model Router sends a history as the harness wrote it, so a
 * Session that stays on Claude keeps its reasoning and its prompt cache. It
 * answers that refusal once: it sends the call again without the earlier
 * thinking, and from then on leaves the thinking out of that part of the
 * Session's history from the start, and keeps it in what comes after.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
  ModelMetadata,
} from "../../modules/model-catalog/index.js";
import { refusesThinking } from "../../modules/model-router/domain/replay.js";
import {
  createModelRouter,
  HARNESS_HEADER,
  type ModelCallRecord,
  type ModelRouter,
} from "../../modules/model-router/index.js";

const SESSION = "x-test-session";
const FOREIGN = "x".repeat(32);
const CLAUDE = "claude-signed";
const FOREIGN_REDACTED = "y".repeat(32);

const seen: { messages: { role: string; content: unknown }[] }[] = [];
const calls: ModelCallRecord[] = [];
let upstream: Server;
let router: ModelRouter;

beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    seen.push(JSON.parse(raw) as (typeof seen)[number]);
    if (raw.includes(FOREIGN_REDACTED)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "messages.1.content.0: Invalid `data` in `redacted_thinking` block",
          },
        }),
      );
      return;
    }
    if (raw.includes(FOREIGN)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "messages.1.content.0: Invalid `signature` in `thinking` block",
          },
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "m1",
        type: "message",
        model: "claude-opus-5-5",
        content: [],
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const addr = upstream.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const metadata: ModelMetadata = {
    contextWindow: null,
    maxOutputTokens: null,
    reasoning: null,
    vision: null,
    cacheControl: null,
    thinkingFormat: null,
    prices: null,
    source: { limits: "none", prices: "none" },
  };
  const dialects = ["anthropic-messages"] as const;
  const entry: CatalogEntry = {
    name: "cb/claude-opus-5-5",
    alias: "cb",
    connectionId: "conn-cb",
    template: "curve-bender",
    upstreamId: "claude-opus-5-5",
    dialects,
    metadata,
  };
  const providers: CatalogProvider[] = [
    {
      alias: "cb",
      connectionId: "conn-cb",
      template: "curve-bender",
      dialects,
      displayName: "CB",
      status: "listed",
      listedAt: null,
      entries: [entry],
    },
  ];
  router = createModelRouter({
    catalog: { providers: () => providers },
    envState: () => ({
      env: {},
      harnesses: [],
      providers: [
        {
          id: "conn-cb",
          template: "curve-bender",
          env: {
            ANTHROPIC_BASE_URL: `${base}/cb`,
            ANTHROPIC_AUTH_TOKEN: "sk-platform:conn:conn-cb",
          },
        },
      ],
    }),
    harnesses: { "claude-code": { dialects: [...dialects] } },
    defaultHarness: "claude-code",
    sessionOf: (req) => {
      const id = req.headers[SESSION];
      return typeof id === "string" ? { sessionId: id } : null;
    },
    onCall: (r) => calls.push(r),
    port: 0,
    log: () => {},
  });
  await router.listen();
});

afterAll(async () => {
  await router.close();
  upstream.close();
});

beforeEach(() => {
  seen.length = 0;
  calls.length = 0;
});

async function post(
  session: string,
  messages: unknown[],
): Promise<{ status: number }> {
  const r = await fetch(`${router.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [HARNESS_HEADER]: "claude-code",
      [SESSION]: session,
    },
    body: JSON.stringify({
      model: "cb/claude-opus-5-5",
      max_tokens: 1000,
      messages,
    }),
  });
  await r.text();
  return { status: r.status };
}

const thinking = (signature: string) => ({
  type: "thinking",
  thinking: "",
  signature,
});
const text = (value: string) => ({ type: "text", text: value });
const user = (value: string) => ({ role: "user", content: value });
const assistant = (...content: unknown[]) => ({ role: "assistant", content });

const switched = [
  user("start on another model"),
  assistant(thinking(FOREIGN), text("a")),
  user("go on"),
  assistant(thinking(FOREIGN)),
  user("now on Claude"),
  assistant(thinking(CLAUDE), text("b")),
  user("more"),
];

describe("thinking blocks in a Messages history", () => {
  /** TEST_SCENARIO: a Session that never left Claude sends several turns,
   * each with a signed thinking block. Every block reaches the provider in
   * one call, so the cached prefix of the last call still matches. */
  it("sends a Claude-only history as the harness wrote it", async () => {
    const history = [
      user("hi"),
      assistant(thinking(CLAUDE), text("a")),
      user("more"),
      assistant(thinking(CLAUDE), text("b")),
      user("and more"),
    ];
    const r = await post("stays", history);
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.messages).toEqual(history);
  });

  /** TEST_SCENARIO: a Session moved from another model to Claude, so its
   * history holds thinking blocks Claude refuses. The call goes again
   * without the thinking of the earlier messages; the message that held only
   * thinking is gone, since the provider refuses an empty content; the last
   * assistant message keeps its block for a tool loop in flight. */
  it("answers the refusal once, without the earlier thinking", async () => {
    const r = await post("moved", switched);
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.messages).toEqual([
      user("start on another model"),
      assistant(text("a")),
      user("go on"),
      user("now on Claude"),
      assistant(thinking(CLAUDE), text("b")),
      user("more"),
    ]);
    expect(calls.map((c) => c.status)).toEqual([400, 200]);
  });

  /** TEST_SCENARIO: a GPT model behind a proxy answers with a redacted
   * thinking block, which Claude refuses in other words than a signed one.
   * That refusal is answered the same way, so the person sees a reply and
   * not the provider's error. */
  it("answers the refusal of a redacted block another model wrote", async () => {
    const r = await post("from-gpt", [
      user("start on GPT"),
      assistant(
        { type: "redacted_thinking", data: FOREIGN_REDACTED },
        text("a"),
      ),
      user("now on Claude"),
      assistant(thinking(CLAUDE), text("b")),
      user("more"),
    ]);
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[1]!.messages).toEqual([
      user("start on GPT"),
      assistant(text("a")),
      user("now on Claude"),
      assistant(thinking(CLAUDE), text("b")),
      user("more"),
    ]);
  });

  /** TEST_SCENARIO: the three refusals Anthropic gave when probed with a
   * block another model wrote are recognized; an error about thinking that
   * removing blocks cannot fix is not, so it costs no second call. */
  it("recognizes only the refusals that removing thinking answers", () => {
    expect(
      refusesThinking(
        "messages.1.content.0: Invalid `signature` in `thinking` block",
      ),
    ).toBe(true);
    expect(
      refusesThinking(
        "messages.2.content.0.thinking.signature: Field required",
      ),
    ).toBe(true);
    expect(
      refusesThinking(
        "messages.1.content.0: Invalid `data` in `redacted_thinking` block",
      ),
    ).toBe(true);
    expect(
      refusesThinking(
        "thinking.budget_tokens: Input should be less than max_tokens",
      ),
    ).toBe(false);
    expect(
      refusesThinking(
        "Expected `thinking` or `redacted_thinking`, but found `tool_use`",
      ),
    ).toBe(false);
  });

  /** TEST_SCENARIO: the next turn of that Session carries the same history
   * plus new Claude turns. It goes out once, with the thinking left out of
   * the part that was refused and kept in the turns written since, so those
   * keep matching the prompt cache. Another Session is not affected. */
  it("keeps the thinking written after the refusal", async () => {
    await post("moved-on", switched);
    seen.length = 0;
    calls.length = 0;
    const later = [
      ...switched,
      assistant(thinking(CLAUDE), text("c")),
      user("next"),
      assistant(thinking(CLAUDE), text("d")),
      user("last"),
    ];
    const r = await post("moved-on", later);
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.messages).toEqual([
      user("start on another model"),
      assistant(text("a")),
      user("go on"),
      user("now on Claude"),
      assistant(text("b")),
      user("more"),
      assistant(thinking(CLAUDE), text("c")),
      user("next"),
      assistant(thinking(CLAUDE), text("d")),
      user("last"),
    ]);
    seen.length = 0;
    await post("other", [
      user("hi"),
      assistant(thinking(CLAUDE), text("a")),
      user("x"),
      assistant(text("b")),
      user("y"),
    ]);
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen[0])).toContain(CLAUDE);
  });
});
