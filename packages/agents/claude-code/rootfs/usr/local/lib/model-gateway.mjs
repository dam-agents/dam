import http from "node:http";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";

const HOST = "127.0.0.1";
// UNIT_BOUNDARY_DESCRIPTION: the gateway listens on 24180, the port the image ABI fixes. MODEL_GATEWAY_PORT overrides it for tests, 0 meaning any free port, and the listening line names the port bound.
const PORT = Number(process.env.MODEL_GATEWAY_PORT ?? 24180);
const SNAPSHOT_FILE = `${process.env.HOME}/.platform/pod-service-env.json`;
const CATALOG_FILE = `${process.env.HOME}/.platform/model-gateway-catalog.json`;
const PREFIX = "claude/";
const TIERS = ["fable", "opus", "sonnet", "haiku"];

const log = (msg) => process.stderr.write(`model-gateway: ${msg}\n`);

const catalogs = (() => {
  try {
    return JSON.parse(readFileSync(CATALOG_FILE, "utf8"));
  } catch {
    return {};
  }
})();

function saveCatalog(upstream, ids) {
  const entry = { base: upstream.base, ids };
  if (JSON.stringify(catalogs[upstream.key]) === JSON.stringify(entry)) return;
  catalogs[upstream.key] = entry;
  try {
    writeFileSync(`${CATALOG_FILE}.tmp`, JSON.stringify(catalogs));
    renameSync(`${CATALOG_FILE}.tmp`, CATALOG_FILE);
  } catch (err) {
    log(`model list not kept for the next start (${err.message})`);
  }
}

function customUpstream(raw) {
  const base = (raw ?? "").replace(/\/+$/, "");
  if (!base || /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base))
    return null;
  return base;
}

const upstreams = new Map();

function front(key, env) {
  const base = customUpstream(env.ANTHROPIC_BASE_URL);
  const token = env.ANTHROPIC_AUTH_TOKEN || "";
  const current = upstreams.get(key);
  if (!base) return upstreams.delete(key);
  if (current?.base === base && current.token === token) return false;
  const kept = catalogs[key];
  const cached =
    kept?.base === base && Array.isArray(kept.ids) ? kept.ids.map(String) : [];
  const next = {
    key,
    base,
    token,
    knownModels: new Map(cached.map((id) => [publicName(id), id])),
    publishedTiers: new Map(),
  };
  upstreams.set(key, next);
  log(`fronting ${base}${key ? ` for provider ${key}` : ""}`);
  next.ready = refreshCatalog(next);
  return true;
}

function readSnapshot() {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8"));
  } catch (err) {
    log(`unreadable env snapshot (${err.message})`);
    return null;
  }
}

function applySnapshot(snapshot) {
  front("", snapshot.env ?? {});
  const providers = snapshot.providers ?? {};
  for (const key of upstreams.keys())
    if (key && !Object.hasOwn(providers, key)) upstreams.delete(key);
  for (const [key, env] of Object.entries(providers)) front(key, env ?? {});
}

applySnapshot(readSnapshot() ?? { env: process.env });
if (upstreams.size === 0) {
  log("no custom upstream; nothing to front");
  process.exit(0);
}

function publicName(id) {
  const name = id.toLowerCase();
  return name.startsWith(PREFIX) ? name : PREFIX + name;
}

const resolveModel = (upstream, name) => {
  const known = upstream.knownModels.get(name);
  if (known) return known;
  const bare = name.toLowerCase().startsWith(PREFIX)
    ? name.slice(PREFIX.length)
    : name;
  const models = [...upstream.knownModels.values()];
  if (!models.length || models.includes(bare)) return bare;
  const tier =
    upstream.publishedTiers.get(name) ??
    TIERS.find((t) => bare.toLowerCase().includes(t));
  return tier ? tierModels(models)[tier] : bare;
};

const isEmbedding = (m) =>
  ["id", "mode", "type"].some((f) =>
    String(m?.[f] ?? "")
      .toLowerCase()
      .includes("embedding"),
  );

async function fetchCatalog(upstream) {
  try {
    const r = await fetch(`${upstream.base}/v1/models?limit=1000`, {
      headers: {
        authorization: `Bearer ${upstream.token}`,
        "x-api-key": upstream.token,
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

async function refreshCatalog(upstream) {
  const ids = await fetchCatalog(upstream);
  if (ids && upstreams.get(upstream.key) === upstream) {
    if (ids.join("\n") !== [...upstream.knownModels.values()].join("\n"))
      log(`serving ${ids.length} model(s)${upstream.key ? ` for provider ${upstream.key}` : ""}`);
    upstream.knownModels = new Map(ids.map((id) => [publicName(id), id]));
    saveCatalog(upstream, ids);
  }
  return ids;
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

function tierModels(models) {
  const [fable, opus, sonnet, haiku] = TIERS.map((t) => latest(models, t));
  const fallback = opus ?? sonnet ?? haiku ?? models.toSorted(byVersion).at(-1);
  return {
    fable: fable ?? fallback,
    opus: fallback,
    sonnet: sonnet ?? fallback,
    haiku: haiku ?? sonnet ?? fallback,
  };
}

function envLines(upstream) {
  const models = [...upstream.knownModels.values()];
  const tiers = models.length
    ? Object.entries(tierModels(models)).map(([t, m]) => [t, publicName(m)])
    : TIERS.map((t) => [t, PREFIX + t]);
  for (const [tier, name] of tiers) upstream.publishedTiers.set(name, tier);
  return tiers
    .map(([tier, name]) => [`ANTHROPIC_DEFAULT_${tier.toUpperCase()}_MODEL`, name])
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

function rewriteModel(body, contentType, map) {
  if (!body.length || !(contentType ?? "").includes("json")) return body;
  try {
    const obj = JSON.parse(body.toString("utf8"));
    return typeof obj?.model === "string"
      ? Buffer.from(JSON.stringify({ ...obj, model: map(obj.model) }))
      : body;
  } catch {
    return body;
  }
}

const keepHeaders = (entries, drop) =>
  Object.fromEntries(
    entries.filter(([k, v]) => !drop.has(k) && typeof v === "string"),
  );

async function listed(upstream) {
  if (!upstream.knownModels.size) await upstream.ready;
  if (!upstream.knownModels.size) await refreshCatalog(upstream);
}

async function proxy(upstream, path, req, res) {
  await listed(upstream);
  const raw = Buffer.concat(await Array.fromAsync(req));
  const contentType = req.headers["content-type"];
  let model;
  const body = rewriteModel(raw, contentType, (name) => (model = resolveModel(upstream, name)));
  const headers = keepHeaders(Object.entries(req.headers), REQ_DROP);

  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });

  const send = (body) =>
    fetch(upstream.base + path, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
      signal: ac.signal,
    });
  let r;
  try {
    r = await send(body);
    const models = [...upstream.knownModels.values()];
    if ([400, 404].includes(r.status) && models.length && model !== undefined && !models.includes(model)) {
      const refusal = await r.text();
      if (refusal.includes(model)) {
        const standIn = tierModels(models).opus;
        log(`${model} is not listed${upstream.key ? ` by provider ${upstream.key}` : ""} and was refused; sending ${standIn} instead`);
        r = await send(rewriteModel(raw, contentType, () => standIn));
      } else r = new Response(refusal, r);
    }
  } catch (err) {
    if (!ac.signal.aborted) {
      const reason = err.cause?.message ?? err.message;
      log(`upstream request failed (${reason})`);
      res.writeHead(502, { "content-type": "application/json" }).end(
        JSON.stringify({
          error: {
            type: "api_error",
            message: `model-gateway: upstream unreachable: ${reason}`,
          },
        }),
      );
    }
    return;
  }

  res.writeHead(r.status, keepHeaders([...r.headers], RES_DROP));
  if (r.body) {
    const upstream = Readable.fromWeb(r.body);
    upstream.on("error", () => res.destroy());
    upstream.pipe(res);
  } else res.end();
}

const PROVIDER_PATH = /^\/p\/([^/]+)(\/.*)?$/;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const scoped = PROVIDER_PATH.exec(url.pathname);
  const upstream = upstreams.get(scoped ? decodeURIComponent(scoped[1]) : "");
  const path = scoped ? (scoped[2] ?? "/") : url.pathname;
  if (!upstream) {
    res.writeHead(502, { "content-type": "application/json" }).end(
      JSON.stringify({
        error: {
          type: "api_error",
          message: "model-gateway: no upstream for this provider",
        },
      }),
    );
    return;
  }
  if (req.method === "GET" && path === "/env.sh") {
    res
      .writeHead(200, { "content-type": "text/plain" })
      .end(envLines(upstream));
    return;
  }
  if (req.method === "GET" && path === "/v1/models") {
    const respond = () =>
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          data: [...upstream.knownModels.values()].map((id) => ({
            id: publicName(id),
            type: "model",
          })),
          has_more: false,
        }),
      );
    if (upstream.knownModels.size) {
      void refreshCatalog(upstream);
      respond();
    } else {
      void listed(upstream).then(respond);
    }
    return;
  }
  void proxy(upstream, path + url.search, req, res).catch((err) => {
    log(`proxy error: ${err.message}`);
    res.destroy();
  });
});

process.on("SIGHUP", () => {
  const snapshot = readSnapshot();
  if (!snapshot) {
    log("reload: keeping env");
    return;
  }
  applySnapshot(snapshot);
  if (upstreams.size === 0) {
    log("reload: no custom upstream; exiting");
    process.exit(0);
  }
});

server.listen(PORT, HOST, () =>
  log(`listening on ${HOST}:${server.address().port}, fronting ${upstreams.size} upstream(s)`),
);
