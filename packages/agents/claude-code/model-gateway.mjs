import http from "node:http";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

const HOST = "127.0.0.1";
const PORT = 24180;
const SNAPSHOT_FILE = `${process.env.HOME}/.platform/pod-service-env.json`;
const PREFIX = "claude/";

const log = (msg) => process.stderr.write(`model-gateway: ${msg}\n`);

function customUpstream(raw) {
  const base = (raw ?? "").replace(/\/+$/, "");
  if (!base || /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base))
    return null;
  return base;
}

let UPSTREAM = customUpstream(process.env.ANTHROPIC_BASE_URL);
let TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || "";
if (!UPSTREAM) {
  log("no custom upstream; nothing to front");
  process.exit(0);
}

let knownModels = new Map();

const publicName = (id) => {
  const name = id.toLowerCase();
  return name.startsWith(PREFIX) ? name : PREFIX + name;
};

const resolveModel = (name) =>
  knownModels.get(name) ??
  (name.toLowerCase().startsWith(PREFIX) ? name.slice(PREFIX.length) : name);

const isEmbedding = (m) =>
  ["id", "mode", "type"].some((f) =>
    String(m?.[f] ?? "")
      .toLowerCase()
      .includes("embedding"),
  );

async function fetchCatalog() {
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
        data.filter((m) => m?.id && !isEmbedding(m)).map((m) => String(m.id)),
      ),
    ].sort();
    return ids.length ? ids : null;
  } catch (err) {
    log(`model fetch failed (${err.message}); keeping current models`);
    return null;
  }
}

async function refreshCatalog() {
  const upstream = UPSTREAM;
  const ids = await fetchCatalog();
  if (ids && UPSTREAM === upstream) applyCatalog(ids);
  return ids;
}

function applyCatalog(ids) {
  if (ids.join("\n") !== [...knownModels.values()].join("\n"))
    log(`serving ${ids.length} model(s)`);
  knownModels = new Map(ids.map((id) => [publicName(id), id]));
}

const isDateLike = (p) => p.length >= 8;
const versionKey = (id) => {
  const parts = id.match(/\d+/g) ?? [];
  return [
    parts.filter((p) => !isDateLike(p)).map(Number),
    parts.filter(isDateLike).map(Number),
  ];
};
const cmpParts = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
};
const byVersion = (a, b) => {
  const [va, da] = versionKey(a);
  const [vb, db] = versionKey(b);
  return cmpParts(va, vb) || cmpParts(da, db) || (a < b ? -1 : a > b ? 1 : 0);
};
const latest = (models, tier) => {
  const tiered = models.filter((m) => m.toLowerCase().includes(tier));
  return tiered.length ? tiered.sort(byVersion).at(-1) : null;
};

const shQuote = (v) => `'${v.replaceAll("'", "'\\''")}'`;

function envLines() {
  const models = [...knownModels.values()];
  if (!models.length) return "";
  const [opus, sonnet, haiku] = ["opus", "sonnet", "haiku"].map((t) =>
    latest(models, t),
  );
  const fallback = opus ?? sonnet ?? haiku ?? models.toSorted(byVersion).at(-1);
  return Object.entries({
    ANTHROPIC_DEFAULT_OPUS_MODEL: publicName(fallback),
    ANTHROPIC_DEFAULT_SONNET_MODEL: publicName(sonnet ?? fallback),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: publicName(haiku ?? sonnet ?? fallback),
  })
    .map(([k, v]) => `[ -n "\${${k}:-}" ] || export ${k}=${shQuote(v)}\n`)
    .join("");
}

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
const RES_DROP = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

function rewriteModel(body, contentType) {
  if (!body.length || !(contentType ?? "").includes("json")) return body;
  try {
    const obj = JSON.parse(body.toString("utf8"));
    return typeof obj?.model === "string"
      ? Buffer.from(JSON.stringify({ ...obj, model: resolveModel(obj.model) }))
      : body;
  } catch {
    return body;
  }
}

const keepHeaders = (entries, drop) =>
  Object.fromEntries(
    entries.filter(([k, v]) => !drop.has(k) && typeof v === "string"),
  );

async function proxy(req, res) {
  const body = rewriteModel(
    Buffer.concat(await Array.fromAsync(req)),
    req.headers["content-type"],
  );
  const headers = keepHeaders(Object.entries(req.headers), REQ_DROP);

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
      res.writeHead(502, { "content-type": "application/json" }).end(
        JSON.stringify({
          error: {
            type: "api_error",
            message: `model-gateway: upstream unreachable: ${err.cause?.message ?? err.message}`,
          },
        }),
      );
    }
    return;
  }

  res.writeHead(r.status, keepHeaders([...r.headers], RES_DROP));
  if (r.body) Readable.fromWeb(r.body).pipe(res);
  else res.end();
}

const server = http.createServer((req, res) => {
  const path = new URL(req.url, `http://${HOST}`).pathname;
  if (req.method === "GET" && path === "/env.sh") {
    res.writeHead(200, { "content-type": "text/plain" }).end(envLines());
    return;
  }
  if (req.method === "GET" && path === "/v1/models") {
    const respond = () =>
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          data: [...knownModels.values()].map((id) => ({
            id: publicName(id),
            type: "model",
          })),
          has_more: false,
        }),
      );
    if (knownModels.size) {
      void refreshCatalog();
      respond();
    } else {
      void refreshCatalog().then(respond);
    }
    return;
  }
  void proxy(req, res).catch((err) => {
    log(`proxy error: ${err.message}`);
    res.destroy();
  });
});

process.on("SIGHUP", () => {
  let env;
  try {
    env = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")).env ?? {};
  } catch (err) {
    log(`reload: unreadable env snapshot (${err.message}); keeping env`);
    return;
  }
  const base = customUpstream(env.ANTHROPIC_BASE_URL);
  if (!base) {
    log("reload: no custom upstream; exiting");
    process.exit(0);
  }
  if (base !== UPSTREAM || (env.ANTHROPIC_AUTH_TOKEN || "") !== TOKEN) {
    UPSTREAM = base;
    TOKEN = env.ANTHROPIC_AUTH_TOKEN || "";
    knownModels = new Map();
    log(`reload: fronting ${UPSTREAM}`);
    void refreshCatalog();
  }
});

if (!(await refreshCatalog()))
  log(
    "no models discovered yet; passthrough only (built-in names still route)",
  );
server.listen(PORT, HOST, () =>
  log(`listening on ${HOST}:${PORT}, fronting ${UPSTREAM}`),
);
