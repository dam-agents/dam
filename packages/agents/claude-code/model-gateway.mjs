// Local model gateway for the claude-code agent (ADR-066). Fronts a custom
// Anthropic-compatible upstream with a loopback passthrough proxy whose only
// per-request job is model-name translation: Claude Code's gateway model
// discovery ignores ids without a provider prefix (verified empirically — raw
// upstream ids never reach the /model picker), so GET /v1/models is served
// claude/<id>-prefixed and the prefix is mapped back to the verbatim upstream
// id on every request. Everything else passes through byte-for-byte — bodies
// are not re-encoded, so unknown fields and beta headers survive (unlike a
// full LiteLLM proxy, which parses and re-issues requests via its SDK).
//
// Also derives Claude Code's model env-var pins (latest model per tier) from
// the discovered catalog and writes them to a shim-sourced env file.
//
// Runs as the agent-runtime-supervised pod service (pod-service.sh, ADR-065):
// spawned with the current runtime env, respawned on env change, restarted
// with backoff on crash. The upstream hop crosses the Envoy gateway for
// credential injection via NODE_USE_ENV_PROXY (set by pod-service.sh); the
// platform MITM CA reaches Node through the controller-injected
// NODE_EXTRA_CA_CERTS.

import http from "node:http";
import { writeFileSync, renameSync } from "node:fs";
import { Readable } from "node:stream";

const HOST = process.env.MODEL_GATEWAY_HOST || "127.0.0.1";
const PORT = Number(process.env.MODEL_GATEWAY_PORT || "4000");
const REFRESH_MS =
  Number(process.env.MODEL_GATEWAY_REFRESH_SECONDS || "600") * 1000;
const ENV_FILE = "/tmp/model-gateway.env"; // sourced by model-gateway.sh
const PREFIX = "claude/";
// The supervisor spawns us with the runtime env, where ANTHROPIC_BASE_URL is
// still the real upstream (only harness sessions get re-pointed at loopback).
const UPSTREAM = (process.env.ANTHROPIC_BASE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || "";

const log = (msg) => process.stderr.write(`model-gateway: ${msg}\n`);

// public (prefixed, lowercased) name -> verbatim upstream id, from the last
// successful catalog fetch. Unknown names fall back to a bare prefix strip,
// so Claude Code's built-in model names still route when discovery failed.
let knownModels = new Map();

const publicName = (id) => {
  const name = id.toLowerCase();
  return name.startsWith(PREFIX) ? name : PREFIX + name;
};

const resolveModel = (name) =>
  knownModels.get(name) ??
  (name.toLowerCase().startsWith(PREFIX) ? name.slice(PREFIX.length) : name);

// Embedding models can't serve chat; detect via an explicit mode/type flag
// (LiteLLM-style upstreams set mode='embedding') or an id substring.
const isEmbedding = (m) =>
  ["id", "mode", "type"].some((f) =>
    String(m?.[f] ?? "")
      .toLowerCase()
      .includes("embedding"),
  );

/** Sorted verbatim upstream model ids, or null on failure. */
async function fetchCatalog() {
  if (!UPSTREAM) return null;
  try {
    const r = await fetch(`${UPSTREAM}/v1/models?limit=1000`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "x-api-key": TOKEN,
        "anthropic-version": "2023-06-01",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`upstream responded ${r.status}`);
    const data = (await r.json())?.data;
    if (!Array.isArray(data)) return null;
    const ids = [
      ...new Set(
        data
          .filter((m) => m?.id && !isEmbedding(m))
          .map((m) => String(m.id)),
      ),
    ].sort();
    return ids.length ? ids : null;
  } catch (err) {
    log(`model fetch failed (${err.message}); keeping current models`);
    return null;
  }
}

// Numeric components approximate "latest" (opus-4-8 > opus-4-1 > 3-opus).
const versionKey = (id) => (id.match(/\d+/g) ?? []).map(Number);
const byVersion = (a, b) => {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? -1) - (kb[i] ?? -1);
    if (d) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};
const latest = (models, tier) => {
  const tiered = models.filter((m) => m.toLowerCase().includes(tier));
  return tiered.length ? tiered.sort(byVersion).at(-1) : null;
};

/** Claude Code's model vars -> latest opus/sonnet/haiku, each falling back to
 *  the best available model so they are always set. The subagent pin mirrors
 *  the retired IBM LiteLLM preset default (opus). */
function modelEnv(models) {
  const [opus, sonnet, haiku] = ["opus", "sonnet", "haiku"].map((t) =>
    latest(models, t),
  );
  const fallback = opus ?? sonnet ?? haiku ?? models.toSorted(byVersion).at(-1);
  if (!opus && !sonnet && !haiku)
    log(`no opus/sonnet/haiku model in upstream set; pinning every tier to '${fallback}'`);
  return {
    ANTHROPIC_DEFAULT_OPUS_MODEL: publicName(opus ?? fallback),
    ANTHROPIC_DEFAULT_SONNET_MODEL: publicName(sonnet ?? fallback),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: publicName(haiku ?? fallback),
    ANTHROPIC_MODEL: publicName(opus ?? fallback),
    CLAUDE_CODE_SUBAGENT_MODEL: publicName(opus ?? fallback),
  };
}

const shQuote = (v) => `'${v.replaceAll("'", "'\\''")}'`;

/** Env lines assign only if unset, so a model set manually on the agent wins. */
function writePins(models) {
  const env = modelEnv(models);
  const lines = Object.entries(env)
    .map(([k, v]) => `[ -n "\${${k}:-}" ] || export ${k}=${shQuote(v)}\n`)
    .join("");
  writeFileSync(`${ENV_FILE}.tmp`, lines);
  renameSync(`${ENV_FILE}.tmp`, ENV_FILE);
  log(
    `serving ${models.length} model(s); env -> ` +
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join(", "),
  );
}

function applyCatalog(ids) {
  knownModels = new Map(ids.map((id) => [publicName(id), id]));
  writePins(ids);
}

// Hop-by-hop / recomputed headers, dropped when forwarding the request.
// accept-encoding goes too: fetch() negotiates and transparently decompresses.
const REQ_DROP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
]);
// fetch() already decompressed the body, so the encoding/length headers on the
// response no longer describe what we forward.
const RES_DROP = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

async function proxy(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = Buffer.concat(chunks);

  // The model field is the one thing we rewrite (messages, count_tokens, ...).
  if ((req.headers["content-type"] ?? "").includes("json") && body.length) {
    try {
      const obj = JSON.parse(body.toString("utf8"));
      if (typeof obj?.model === "string") {
        obj.model = resolveModel(obj.model);
        body = Buffer.from(JSON.stringify(obj));
      }
    } catch {
      // not JSON after all — forward verbatim
    }
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers))
    if (!REQ_DROP.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;

  // Abort the upstream call when the client goes away mid-stream.
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });

  let r;
  try {
    r = await fetch(UPSTREAM + req.url, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
      signal: ac.signal,
    });
  } catch (err) {
    if (!ac.signal.aborted) {
      log(`upstream request failed (${err.cause?.message ?? err.message})`);
      res
        .writeHead(502, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { type: "api_error", message: `model-gateway: upstream unreachable: ${err.cause?.message ?? err.message}` } }));
    }
    return;
  }

  const resHeaders = {};
  for (const [k, v] of r.headers) if (!RES_DROP.has(k)) resHeaders[k] = v;
  res.writeHead(r.status, resHeaders);
  if (r.body) Readable.fromWeb(r.body).pipe(res);
  else res.end();
}

const server = http.createServer((req, res) => {
  if (req.url === "/health/liveliness") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/v1/models")) {
    // Always re-fetch: Claude Code asks once per session, and a live answer
    // keeps the catalog fresh without any restart machinery.
    void fetchCatalog().then((ids) => {
      if (ids) applyCatalog(ids);
      const names = ids ?? [...knownModels.values()];
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          data: names.map((id) => ({ id: publicName(id), type: "model" })),
          has_more: false,
        }),
      );
    });
    return;
  }
  void proxy(req, res).catch((err) => {
    log(`proxy error: ${err.message}`);
    res.destroy();
  });
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

const ids = await fetchCatalog();
if (ids) applyCatalog(ids);
else
  log(
    "no models discovered yet; serving passthrough so Claude Code's built-in " +
      "model names still route to the upstream",
  );
setInterval(async () => {
  const fresh = await fetchCatalog();
  if (fresh && fresh.join("\n") !== [...knownModels.values()].join("\n")) {
    log(`models changed (${knownModels.size} -> ${fresh.length})`);
    applyCatalog(fresh);
  }
}, REFRESH_MS).unref?.();

server.listen(PORT, HOST, () =>
  log(`listening on ${HOST}:${PORT}, fronting ${UPSTREAM}`),
);
