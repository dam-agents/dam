/**
 * TEST_OVERVIEW: Bob's command-safety check asks the router for a model named
 * `security`. A granted provider that lists the name answers it as any bare
 * name does. Where none does, Bob's harness gets CurveBender's preferred
 * classifier, its Nemotron, so a CurveBender-only agent runs commands
 * unattended. A picked session model still takes the call first. Bob's other
 * models, another harness's call for the same name and an agent with no
 * CurveBender keep the refusal, and the stand-in call leaves as Bob sent it,
 * structured output included, booked to CurveBender.
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CatalogEntry,
  CatalogProvider,
  ModelMetadata,
} from "../../modules/model-catalog/index.js";
import type { RuntimeEnvState } from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import {
  createModelRouter,
  HARNESS_HEADER,
  type ModelCallRecord,
  type ModelRouter,
} from "../../modules/model-router/index.js";

const CB_NEMOTRON = "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4";
const CB_WORK = "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017";
const BOB_SECURITY = "security";

interface Seen {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

const seen: Seen[] = [];
const calls: ModelCallRecord[] = [];
const routers: ModelRouter[] = [];
let upstream: Server;
let upstreamBase: string;

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

type FixtureAlias = "cb" | "bob" | "ibm";

const listings: Record<
  FixtureAlias,
  {
    connectionId: string;
    template: string;
    dialect: "openai-chat";
    ids: string[];
  }
> = {
  cb: {
    connectionId: "conn-cb",
    template: "curve-bender",
    dialect: "openai-chat",
    ids: [CB_WORK, CB_NEMOTRON],
  },
  bob: {
    connectionId: "conn-bob",
    template: "bob",
    dialect: "openai-chat",
    ids: [BOB_SECURITY, "premium-ide"],
  },
  ibm: {
    connectionId: "conn-ibm",
    template: "ibm-litellm",
    dialect: "openai-chat",
    ids: ["gpt-5.5"],
  },
};

function provider(alias: FixtureAlias): CatalogProvider {
  const { connectionId, template, dialect, ids } = listings[alias];
  return {
    connectionId,
    alias,
    template,
    displayName: alias,
    dialects: [dialect],
    status: "listed",
    listedAt: null,
    entries: ids.map((upstreamId): CatalogEntry => ({
      name: `${alias}/${upstreamId}`,
      alias,
      connectionId,
      template,
      upstreamId,
      dialects: [dialect],
      metadata,
    })),
  };
}

function envState(): RuntimeEnvState {
  const layer = (alias: FixtureAlias) => {
    const { connectionId, template } = listings[alias];
    const base = `${upstreamBase}/${alias}`;
    const env: Record<string, string> =
      alias === "bob"
        ? { BOB_DEFAULT_GATEWAY_URL: base, BOBSHELL_API_KEY: "dummy" }
        : {
            OPENAI_BASE_URL: base,
            OPENAI_API_KEY: `platform:${connectionId}`,
          };
    return { id: connectionId, template, env };
  };
  return {
    env: {},
    harnesses: [],
    providers: (["cb", "bob", "ibm"] as const).map(layer),
  };
}

async function routerFor(
  aliases: readonly FixtureAlias[],
): Promise<ModelRouter> {
  const router = createModelRouter({
    catalog: { providers: () => aliases.map(provider) },
    envState,
    harnesses: {
      "claude-code": { dialects: ["anthropic-messages"] },
      codex: { dialects: ["openai-chat"] },
      bob: {
        dialects: ["openai-chat"],
        modelFromSession: true,
        tierAliases: ["premium-ide"],
        bobGateway: true,
      },
    },
    defaultHarness: "claude-code",
    sessionOf: (req) => {
      const id = req.headers["x-test-session"] as string | undefined;
      return id ? { sessionId: id } : null;
    },
    sessionModelOf: (id) =>
      id === "s-picked" ? { model: `cb/${CB_WORK}` } : { model: null },
    onCall: (record) => calls.push(record),
    port: 0,
    log: () => {},
  });
  await router.listen();
  routers.push(router);
  return router;
}

async function call(
  router: ModelRouter,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  text: string;
  json: Record<string, unknown> | null;
}> {
  const r = await fetch(`${router.baseUrl}/inference/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {}
  return { status: r.status, text, json };
}

const STRUCTURED_CHECK = {
  model: BOB_SECURITY,
  messages: [
    {
      role: "system",
      content: "Return a JSON object with dangerous and reason.",
    },
    {
      role: "user",
      content: "Command to analyze:\n```\nls -la ~/work\n```\n",
    },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      schema: {
        type: "object",
        properties: {
          dangerous: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["dangerous"],
        additionalProperties: false,
      },
      strict: true,
      name: "response",
    },
  },
};

beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<
          string,
          unknown
        >)
      : {};
    seen.push({ path: req.url ?? "", headers: req.headers, body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "c",
        model: body.model,
        choices: [
          { message: { role: "assistant", content: '{"dangerous":false}' } },
        ],
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const addr = upstream.address();
  upstreamBase = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  for (const router of routers) await router.close();
  upstream.close();
});

describe("Bob's security check", () => {
  /** TEST_SCENARIO: Bob Shell's Connection lists the `security` model, so the
   * check resolves there as any bare name does, on the harness's home
   * provider, and CurveBender is not used even though it is granted. */
  it("runs where a granted provider lists the name", async () => {
    seen.length = 0;
    const router = await routerFor(["cb", "bob"]);
    const r = await call(router, STRUCTURED_CHECK);
    expect(r.status).toBe(200);
    expect(seen[0]!.path).toBe("/bob/inference/v1/chat/completions");
    expect(seen[0]!.body.model).toBe(BOB_SECURITY);
    expect(seen[0]!.headers[HARNESS_HEADER]).toBe("bob");
    expect(r.json?.model).toBe(`bob/${BOB_SECURITY}`);
  });

  /** TEST_SCENARIO: With CurveBender alone the name is listed nowhere, so the
   * check runs on its Nemotron, the model the platform already prefers for a
   * classifier there, and the request reaches it as Bob sent it — the
   * structured-output format included — so the check can answer. */
  it("stands in CurveBender's Nemotron where none lists it", async () => {
    seen.length = 0;
    const router = await routerFor(["cb"]);
    const r = await call(router, STRUCTURED_CHECK);
    expect(r.status).toBe(200);
    expect(seen[0]!.path).toBe("/cb/v1/chat/completions");
    expect(seen[0]!.body.model).toBe(CB_NEMOTRON);
    expect(seen[0]!.body.response_format).toEqual(
      STRUCTURED_CHECK.response_format,
    );
    expect(seen[0]!.headers.authorization).toBe("Bearer platform:conn-cb");
    expect(r.json?.model).toBe(`cb/${CB_NEMOTRON}`);
    expect(calls.at(-1)).toMatchObject({
      alias: "cb",
      upstreamId: CB_NEMOTRON,
      requestedModel: BOB_SECURITY,
      harness: "bob",
    });
  });

  /** TEST_SCENARIO: A session whose model is not picked yet lets the check
   * keep its own name and reach the stand-in, which is the path the probe's
   * agent hit; a session with a picked model has already taken the call, and
   * the check runs on that model as it did before this rule. */
  it("stands in on an unpicked session and follows a picked one", async () => {
    seen.length = 0;
    const router = await routerFor(["cb"]);
    const unpicked = await call(router, STRUCTURED_CHECK, {
      "x-test-session": "s-unpicked",
    });
    expect(unpicked.status).toBe(200);
    expect(seen[0]!.body.model).toBe(CB_NEMOTRON);
    const picked = await call(router, STRUCTURED_CHECK, {
      "x-test-session": "s-picked",
    });
    expect(picked.status).toBe(200);
    expect(seen[1]!.body.model).toBe(CB_WORK);
  });

  /** TEST_SCENARIO: No CurveBender granted keeps the refusal the probe saw,
   * naming the granted aliases. Nothing reaches upstream. */
  it("keeps the refusal where CurveBender is not granted", async () => {
    seen.length = 0;
    const router = await routerFor(["ibm"]);
    const r = await call(router, STRUCTURED_CHECK);
    expect(r.status).toBe(404);
    expect(r.text).toContain(
      "no granted provider lists model 'security' for this harness (granted: ibm)",
    );
    expect(seen).toEqual([]);
  });

  /** TEST_SCENARIO: Another harness asking for the same bare name is not
   * Bob's check and keeps the refusal, even with CurveBender granted. */
  it("leaves another harness's request for the name alone", async () => {
    seen.length = 0;
    const router = await routerFor(["cb"]);
    const r = await call(router, STRUCTURED_CHECK, {
      [HARNESS_HEADER]: "codex",
    });
    expect(r.status).toBe(404);
    expect(r.text).toContain("no granted provider lists model 'security'");
    expect(seen).toEqual([]);
  });

  /** TEST_SCENARIO: Bob's other models are unchanged: a tier alias no granted
   * provider lists is refused as before, and a qualified name still routes. */
  it("leaves Bob's other models alone", async () => {
    seen.length = 0;
    const router = await routerFor(["cb"]);
    const refused = await call(router, { model: "premium-ide", messages: [] });
    expect(refused.status).toBe(404);
    expect(seen).toEqual([]);
    const routed = await call(router, { model: `cb/${CB_WORK}`, messages: [] });
    expect(routed.status).toBe(200);
    expect(seen[0]!.body.model).toBe(CB_WORK);
  });
});
