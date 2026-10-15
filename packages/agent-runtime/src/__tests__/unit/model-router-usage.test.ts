/**
 * TEST_OVERVIEW: The Model Router's spend records: the token counts read off
 * each dialect's response, streamed or not, the cost in micro-dollars from the
 * catalog's price, the OTLP log record the spend reader sums, and the export
 * that batches records to the pod's rail and never holds a call.
 */
import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  costUsdMicros,
  createModelCallExporter,
  createSseModelRewrite,
  createUsageScanner,
  otlpLogRecord,
  otlpTargetOf,
  usageOfBody,
  type ModelCallRecord,
} from "../../modules/model-router/index.js";

const sse = (events: unknown[]): string =>
  events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join("");

async function scan(
  dialect: "anthropic-messages" | "openai-chat" | "openai-responses",
  text: string,
  chunk = 7,
) {
  const scanner = createUsageScanner(dialect);
  const pieces: Buffer[] = [];
  for (let i = 0; i < text.length; i += chunk)
    pieces.push(Buffer.from(text.slice(i, i + chunk)));
  const out: Buffer[] = [];
  for await (const c of Readable.from(pieces).pipe(scanner))
    out.push(c as Buffer);
  return { usage: scanner.usage(), passed: Buffer.concat(out).toString() };
}

describe("usage off the stream", () => {
  /** TEST_SCENARIO: Codex closes its connection as soon as the completion
   * event arrives, before the router ends the response. The scanner says the
   * stream completed once the final usage event went by, so that call counts
   * as a whole call; a Messages stream that only started (input usage, no
   * final delta) has not completed and stays cut short. */
  it("tells a completed stream from one that only started", async () => {
    const started = createUsageScanner("anthropic-messages");
    for await (const _ of Readable.from([
      Buffer.from(
        sse([
          { type: "message_start", message: { usage: { input_tokens: 7 } } },
        ]),
      ),
    ]).pipe(started));
    expect(started.completed()).toBe(false);
    const responses = createUsageScanner("openai-responses");
    for await (const _ of Readable.from([
      Buffer.from(
        sse([
          {
            type: "response.completed",
            response: { usage: { input_tokens: 3, output_tokens: 2 } },
          },
        ]),
      ),
    ]).pipe(responses));
    expect(responses.completed()).toBe(true);
    expect(responses.usage()).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
    });
  });

  /** TEST_SCENARIO: Messages reports input and cache counts on
   * message_start and the output count on message_delta; the stream passes
   * through byte for byte however it is chunked. */
  /** TEST_SCENARIO: A Messages stream names the counts in message_start and
   * again in message_delta, where a gateway sends null or 0 for the ones it
   * did not change; the start's counts stand and the delta's output count
   * wins. */
  it("merges Messages' start and delta usage", async () => {
    const text = sse([
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 300,
            cache_creation_input_tokens: 20,
            output_tokens: 1,
          },
        },
      },
      { type: "content_block_delta", delta: { text: "hi" } },
      {
        type: "message_delta",
        delta: {},
        usage: {
          input_tokens: null,
          cache_read_input_tokens: 0,
          output_tokens: 42,
        },
      },
    ]);
    const { usage, passed } = await scan("anthropic-messages", text, 3);
    expect(usage).toEqual({
      inputTokens: 10,
      outputTokens: 42,
      cacheReadTokens: 300,
      cacheCreationTokens: 20,
    });
    expect(passed).toBe(text);
  });

  /** TEST_SCENARIO: A chat completion carries usage on its last chunk, with
   * the cached share inside the prompt count; Responses carries it on
   * response.completed. Both split the cached tokens out of the input. */
  it("reads the final chat chunk and the completed response", async () => {
    const chat = await scan(
      "openai-chat",
      `${sse([
        { choices: [{ delta: { content: "x" } }], usage: null },
        {
          choices: [],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 5,
            prompt_tokens_details: { cached_tokens: 100 },
          },
        },
      ])}data: [DONE]\n\n`,
    );
    expect(chat.usage).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheCreationTokens: 0,
    });
    const responses = await scan(
      "openai-responses",
      sse([
        { type: "response.created", response: {} },
        {
          type: "response.completed",
          response: {
            usage: {
              input_tokens: 50,
              output_tokens: 9,
              input_tokens_details: { cached_tokens: 30 },
            },
          },
        },
      ]),
    );
    expect(responses.usage).toEqual({
      inputTokens: 20,
      outputTokens: 9,
      cacheReadTokens: 30,
      cacheCreationTokens: 0,
    });
  });

  /** TEST_SCENARIO: A stream cut before its usage event, or a chat stream the
   * upstream answered without usage, yields none rather than zeros. */
  it("yields no usage when the stream carries none", async () => {
    const cut = await scan(
      "openai-responses",
      sse([{ type: "response.created", response: {} }]),
    );
    expect(cut.usage).toBeNull();
    const bare = await scan(
      "openai-chat",
      `${sse([{ choices: [{ delta: {} }] }])}data: [DONE]\n\n`,
    );
    expect(bare.usage).toBeNull();
  });
});

describe("the stream rewrite", () => {
  /** TEST_SCENARIO: The upstream's chunks cut a Japanese character and an
   * emoji in the middle of their bytes; the rewritten stream carries the
   * text intact, and the model name the harness asked for. */
  it("keeps a multi-byte character split across two chunks", async () => {
    const text = `data: {"type":"message_start","message":{"model":"aws/claude-sonnet-5"}}\n\ndata: {"type":"content_block_delta","delta":{"text":"日本語😀"}}\n\n`;
    const bytes = Buffer.from(text);
    const cuts = [
      bytes.indexOf(Buffer.from("語")) + 1,
      bytes.indexOf(Buffer.from("😀")) + 2,
    ];
    const pieces = [
      bytes.subarray(0, cuts[0]),
      bytes.subarray(cuts[0], cuts[1]),
      bytes.subarray(cuts[1]),
    ];
    const out: Buffer[] = [];
    for await (const c of Readable.from(pieces).pipe(
      createSseModelRewrite("anthropic-messages", "claude/ibm/aws/claude-sonnet-5"),
    ))
      out.push(c as Buffer);
    expect(Buffer.concat(out).toString()).toBe(
      text.replace("aws/claude-sonnet-5", "claude/ibm/aws/claude-sonnet-5"),
    );
  });
});

describe("usage of an unstreamed body", () => {
  /** TEST_SCENARIO: Each dialect's usage field is read off an unstreamed
   * body; a body without one, or one that is not JSON, yields none. */
  it("reads each dialect's usage field and none from a body without one", () => {
    expect(
      usageOfBody(
        "anthropic-messages",
        JSON.stringify({ usage: { input_tokens: 3, output_tokens: 4 } }),
      ),
    ).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(
      usageOfBody(
        "openai-chat",
        JSON.stringify({ usage: { prompt_tokens: 8, completion_tokens: 2 } }),
      ),
    ).toMatchObject({ inputTokens: 8, outputTokens: 2 });
    expect(
      usageOfBody("openai-responses", JSON.stringify({ output: [] })),
    ).toBeNull();
    expect(usageOfBody("openai-chat", "not json")).toBeNull();
  });
});

describe("cost", () => {
  /** TEST_SCENARIO: Each token class at its own price, cache classes the
   * list does not price charged as input, rounded to whole micro-dollars;
   * no price means no cost, never zero. */
  it("prices the four token classes in micro-dollars", () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 10_000,
      cacheCreationTokens: 500,
    };
    expect(
      costUsdMicros(
        {
          inputPerToken: 3e-6,
          outputPerToken: 15e-6,
          cacheReadPerToken: 0.3e-6,
          cacheWritePerToken: null,
        },
        usage,
      ),
    ).toBe(Math.round((0.003 + 0.0015 + 0.003 + 0.0015) * 1e6));
    expect(costUsdMicros(null, usage)).toBeNull();
  });
});

const record = (over: Partial<ModelCallRecord> = {}): ModelCallRecord => ({
  connectionId: "conn-ibm",
  alias: "ibm",
  upstreamId: "gpt-5.5",
  requestedModel: "ibm/gpt-5.5",
  dialect: "openai-chat",
  harness: "pi",
  session: "sess-1",
  stream: true,
  status: 200,
  startedAt: "2026-10-12T10:00:00.000Z",
  durationMs: 1234,
  usage: {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
  },
  costUsdMicros: 56,
  uncounted: null,
  providerReportedCostUsd: null,
  requestId: "req-1",
  trace: {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
  },
  ...over,
});

describe("the OTLP record", () => {
  /** TEST_SCENARIO: The reader sums the same attribute names it reads from
   * Claude Code's records, so the record carries them as strings under those
   * names, with the platform's own beside them and the harness's trace. */
  it("carries the reader's counters and the platform attributes", () => {
    const log = otlpLogRecord(record());
    const attrs = Object.fromEntries(
      (log.attributes as { key: string; value: { stringValue: string } }[]).map(
        (a) => [a.key, a.value.stringValue],
      ),
    );
    expect(log).toMatchObject({
      body: { stringValue: "platform.model_call" },
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      timeUnixNano: `${BigInt(Date.parse("2026-10-12T10:00:00.000Z")) * 1_000_000n}`,
    });
    expect(attrs).toMatchObject({
      "session.id": "sess-1",
      model: "ibm/gpt-5.5",
      input_tokens: "1",
      output_tokens: "2",
      cache_read_tokens: "3",
      cache_creation_tokens: "4",
      cost_usd_micros: "56",
      duration_ms: "1234",
      request_id: "req-1",
      "platform.model.router": "true",
      "platform.connection.id": "conn-ibm",
      "platform.provider.alias": "ibm",
      "platform.model.upstream": "gpt-5.5",
      "platform.harness": "pi",
      "platform.uncounted": "",
    });
    const cut = otlpLogRecord(
      record({
        usage: null,
        costUsdMicros: null,
        uncounted: "no-usage-event",
        status: 499,
      }),
    );
    const cutAttrs = Object.fromEntries(
      (cut.attributes as { key: string; value: { stringValue: string } }[]).map(
        (a) => [a.key, a.value.stringValue],
      ),
    );
    expect(cutAttrs).toMatchObject({
      cost_usd_micros: "0",
      input_tokens: "0",
      "platform.uncounted": "no-usage-event",
      "platform.status": "499",
    });
  });
});

describe("the export rail", () => {
  const state = (env: Record<string, string>) => ({
    env: {},
    providers: [],
    harnesses: [{ id: "claude-code", env }],
  });

  it("finds the rail on a harness layer, with its headers and resource", () => {
    expect(
      otlpTargetOf(
        state({
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector:4318/",
          OTEL_EXPORTER_OTLP_HEADERS: "x-a=1,x-b=two",
          OTEL_RESOURCE_ATTRIBUTES: "platform.agent.name=bob,team=50%",
        }),
      ),
    ).toEqual({
      url: "https://collector:4318/v1/logs",
      headers: { "x-a": "1", "x-b": "two" },
      resource: {
        "service.name": "platform-model-router",
        "platform.agent.name": "bob",
        team: "50%",
      },
    });
    expect(otlpTargetOf(state({}))).toBeNull();
  });

  /** TEST_SCENARIO: Records queue and leave together on flush as one OTLP
   * post to the rail; a refused post is retried with the next batch once
   * and then dropped with a log line; with no rail nothing is posted. */
  it("batches, retries once and drops", async () => {
    const posts: { url: string; records: number }[] = [];
    let refuse = 0;
    const logs: string[] = [];
    const exporter = createModelCallExporter({
      envState: () =>
        state({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector:4318" }),
      fetchImpl: (async (url: string, init: RequestInit) => {
        const payload = JSON.parse(init.body as string) as {
          resourceLogs: { scopeLogs: { logRecords: unknown[] }[] }[];
        };
        posts.push({
          url,
          records: payload.resourceLogs[0]!.scopeLogs[0]!.logRecords.length,
        });
        if (refuse > 0) {
          refuse -= 1;
          return new Response("no", { status: 503 });
        }
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
      log: (m) => logs.push(m),
      flushMs: 60_000,
    });
    exporter.record(record());
    exporter.record(record());
    await exporter.flush();
    expect(posts).toEqual([
      { url: "https://collector:4318/v1/logs", records: 2 },
    ]);

    refuse = 2;
    exporter.record(record());
    await exporter.flush();
    exporter.record(record());
    await exporter.flush();
    expect(posts.slice(1)).toEqual([
      { url: "https://collector:4318/v1/logs", records: 1 },
      { url: "https://collector:4318/v1/logs", records: 2 },
    ]);
    expect(logs.at(-1)).toMatch(/dropped 1 spend record/);
    exporter.record(record());
    await exporter.flush();
    expect(posts.at(-1)).toEqual({
      url: "https://collector:4318/v1/logs",
      records: 2,
    });

    const silent = createModelCallExporter({
      envState: () => state({}),
      fetchImpl: (async () => {
        throw new Error("must not be called");
      }) as unknown as typeof fetch,
      log: () => {},
    });
    silent.record(record());
    await silent.flush();
  });
});
