/**
 * TEST_OVERVIEW: A model that does not accept images refuses the whole call
 * when the conversation carries one, and a Session's history sends that image
 * again on every later turn. The Model Router answers that refusal once: it
 * sends the call again with each image replaced by a text note, in every
 * dialect, and from then on sends that model's calls without images from the
 * start. Any other provider error passes as before, with no second call.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
  ModelMetadata,
} from "../../modules/model-catalog/index.js";
import {
  imageNote,
  refusesImages,
  withoutImages,
} from "../../modules/model-router/domain/image-blocks.js";
import {
  createModelRouter,
  HARNESS_HEADER,
  type ModelCallRecord,
  type ModelRouter,
} from "../../modules/model-router/index.js";

const VLLM_REFUSAL = JSON.stringify({
  type: "error",
  error: {
    type: "invalid_request_error",
    message:
      'litellm.BadRequestError: Hosted_vllmException - {"type":"error","error":{"type":"invalid_request_error","message":"zai-org/GLM-5.3 is not a multimodal model"}}',
  },
});

const seen: Record<string, unknown>[] = [];
const calls: ModelCallRecord[] = [];
let upstream: Server;
let router: ModelRouter;

const IMAGE_TYPES = new Set(["image", "image_url", "input_image"]);
const hasImage = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasImage)
    : value !== null && typeof value === "object"
      ? IMAGE_TYPES.has(String((value as { type?: unknown }).type)) ||
        Object.values(value).some(hasImage)
      : false;

beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >;
    seen.push(body);
    const model = String(body.model);
    if (model.includes("broken")) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "prompt too long" },
        }),
      );
      return;
    }
    if (model.includes("glm") && hasImage(body)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(VLLM_REFUSAL);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "m1",
        type: "message",
        model,
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
  const dialects = [
    "anthropic-messages",
    "openai-chat",
    "openai-responses",
  ] as const;
  const entry = (upstreamId: string): CatalogEntry => ({
    name: `cb/${upstreamId}`,
    alias: "cb",
    connectionId: "conn-cb",
    template: "curve-bender",
    upstreamId,
    dialects,
    metadata,
  });
  const providers: CatalogProvider[] = [
    {
      alias: "cb",
      connectionId: "conn-cb",
      template: "curve-bender",
      dialects,
      displayName: "CB",
      status: "listed",
      listedAt: null,
      entries: [
        entry("rits/zai-org/glm-5-3"),
        entry("rits/zai-org/glm-5-3-chat"),
        entry("rits/zai-org/glm-5-3-responses"),
        entry("claude-opus-5-5"),
        entry("broken-model"),
      ],
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
    harnesses: {
      "claude-code": { dialects: ["anthropic-messages"] },
      pi: { dialects: [...dialects] },
    },
    defaultHarness: "claude-code",
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
  path: string,
  body: Record<string, unknown>,
  harness = "claude-code",
): Promise<{ status: number; text: string }> {
  const r = await fetch(`${router.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", [HARNESS_HEADER]: harness },
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
}

const PNG = { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" };

const slackTurn = (model: string, text: string) => ({
  model,
  max_tokens: 1000,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "what is on this screenshot?" },
        { type: "image", source: PNG },
      ],
    },
    { role: "assistant", content: [{ type: "text", text: "…" }] },
    { role: "user", content: [{ type: "text", text }] },
  ],
});

describe("a model that does not accept images", () => {
  /** TEST_SCENARIO: the reported failure: a Slack user pastes an image into
   * a Session on a text-only model behind LiteLLM, and vLLM refuses the
   * call. The router sends it once more without the image, so the turn gets
   * an answer, and the model reads a note in the image's place telling it
   * the image was left out. Both calls are reported, the refused one as an
   * error, so the meter's records each have their router record. */
  it("sends the call again with a note in each image's place", async () => {
    const r = await post(
      "/v1/messages",
      slackTurn("cb/rits/zai-org/glm-5-3", "and now?"),
    );
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(hasImage(seen[0])).toBe(true);
    expect(hasImage(seen[1])).toBe(false);
    const first = (seen[1]!.messages as { content: unknown[] }[])[0]!;
    expect(first.content).toEqual([
      { type: "text", text: "what is on this screenshot?" },
      { type: "text", text: imageNote("rits/zai-org/glm-5-3") },
    ]);
    expect(calls.map((c) => [c.status, c.uncounted])).toEqual([
      [400, "error"],
      [200, null],
    ]);
    expect(new Set(calls.map((c) => c.callId)).size).toBe(2);
  });

  /** TEST_SCENARIO: every later turn of that Session carries the image in
   * its history again. The router learnt that the model takes no images, so
   * the next call goes without them at once: one call, no refusal. */
  it("sends that model's later calls without images from the start", async () => {
    await post("/v1/messages", slackTurn("cb/rits/zai-org/glm-5-3", "first"));
    seen.length = 0;
    calls.length = 0;
    const r = await post(
      "/v1/messages",
      slackTurn("cb/rits/zai-org/glm-5-3", "a later reply in the thread"),
    );
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(hasImage(seen[0])).toBe(false);
    expect(calls.map((c) => c.status)).toEqual([200]);
  });

  /** TEST_SCENARIO: Pi speaks the chat and Responses APIs too, whose image
   * parts have other shapes; each becomes that dialect's own text part. */
  it("strips the chat and Responses image parts", async () => {
    const chat = await post(
      "/v1/chat/completions",
      {
        model: "cb/rits/zai-org/glm-5-3-chat",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "see" },
              { type: "image_url", image_url: { url: "data:image/png;x" } },
            ],
          },
        ],
      },
      "pi",
    );
    expect(chat.status).toBe(200);
    expect(
      (seen.at(-1)!.messages as { content: unknown[] }[])[0]!.content,
    ).toEqual([
      { type: "text", text: "see" },
      { type: "text", text: imageNote("rits/zai-org/glm-5-3-chat") },
    ]);
    seen.length = 0;
    const responses = await post(
      "/v1/responses",
      {
        model: "cb/rits/zai-org/glm-5-3-responses",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_image", image_url: "data:image/png;x" }],
          },
        ],
      },
      "pi",
    );
    expect(responses.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(
      (seen[1]!.input as { content: unknown[] }[])[0]!.content,
    ).toEqual([
      {
        type: "input_text",
        text: imageNote("rits/zai-org/glm-5-3-responses"),
      },
    ]);
  });

  /** TEST_SCENARIO: a model that accepts images keeps them, and a provider
   * error that names no images passes back as before, with no second call:
   * a second model call is a second bill. */
  it("leaves every other call and error alone", async () => {
    const vision = await post(
      "/v1/messages",
      slackTurn("cb/claude-opus-5-5", "x"),
    );
    expect(vision.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(hasImage(seen[0])).toBe(true);
    seen.length = 0;
    const broken = await post("/v1/messages", slackTurn("cb/broken-model", "x"));
    expect(broken.status).toBe(400);
    expect(broken.text).toContain("prompt too long");
    expect(seen).toHaveLength(1);
  });
});

describe("image blocks", () => {
  /** TEST_SCENARIO: Claude Code puts a screenshot a tool read inside the
   * tool result's own content, and Codex puts it in a tool output; those
   * images are stripped too. A call with no image is left as it is. */
  it("finds images inside tool results and tool outputs", () => {
    const messages = withoutImages(
      {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t1",
                content: [{ type: "image", source: PNG }],
              },
            ],
          },
        ],
      },
      "anthropic-messages",
      "note",
    );
    expect(messages).toEqual({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "text", text: "note" }],
            },
          ],
        },
      ],
    });
    const responses = withoutImages(
      {
        input: [
          {
            type: "function_call_output",
            call_id: "c1",
            output: [{ type: "input_image", image_url: "data:x" }],
          },
        ],
      },
      "openai-responses",
      "note",
    );
    expect(responses).toEqual({
      input: [
        {
          type: "function_call_output",
          call_id: "c1",
          output: [{ type: "input_text", text: "note" }],
        },
      ],
    });
    expect(
      withoutImages(
        { messages: [{ role: "user", content: "plain text" }] },
        "anthropic-messages",
        "note",
      ),
    ).toBeNull();
  });

  /** TEST_SCENARIO: the refusals providers send for an image to a text-only
   * model are recognised, and other errors are not. */
  it("reads the providers' image refusals", () => {
    expect(refusesImages(VLLM_REFUSAL)).toBe(true);
    expect(
      refusesImages(
        "No endpoints found that support image input",
      ),
    ).toBe(true);
    expect(
      refusesImages(
        "Invalid content type. image_url is only supported by certain models.",
      ),
    ).toBe(true);
    expect(refusesImages("prompt is too long: 210000 tokens")).toBe(false);
    expect(refusesImages("Could not process image")).toBe(false);
  });
});
