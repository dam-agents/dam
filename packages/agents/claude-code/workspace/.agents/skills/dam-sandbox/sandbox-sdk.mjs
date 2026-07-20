// DAM sandbox SDK — a dependency-free wrapper over the platform's sandbox
// primitive (issue #2784). A "driver" agent uses it to spawn ephemeral sandbox
// agents, hand each one a prompt, and get back a schema-validated result,
// without hand-rolling the create-then-poll HTTP dance.
//
// Runs inside an agent pod as plain `node` — no dependencies, only global
// `fetch`. It self-configures from PLATFORM_MCP_URL (the platform sets this to
// <base>/api/agents/<own-id>/mcp), which encodes both the harness base URL and
// this agent's own id. That id is the one the mesh waypoint pins, so every call
// is scoped to and attributed as this driver. There is no token to manage: the
// mesh proves identity.

const mcpUrl = process.env.PLATFORM_MCP_URL;
if (!mcpUrl) {
  throw new Error(
    "PLATFORM_MCP_URL is not set — the sandbox SDK only runs inside a platform agent pod.",
  );
}

const { base, agentId } = (() => {
  const u = new URL(mcpUrl);
  const m = u.pathname.match(/^\/api\/agents\/([^/]+)\/mcp$/);
  if (!m) throw new Error(`unexpected PLATFORM_MCP_URL shape: ${mcpUrl}`);
  return {
    base: `${u.protocol}//${u.host}`,
    agentId: decodeURIComponent(m[1]),
  };
})();

const root = `${base}/api/agents/${encodeURIComponent(agentId)}`;

// ---- schema sugar ---------------------------------------------------------
// The server validates a sandbox's result against a JSON Schema (ajv, structural
// only — never truth). Writing raw JSON Schema in every spawn buries the intent,
// so `s()` expands a tiny shorthand into real JSON Schema. Anything that already
// looks like JSON Schema passes through untouched, so you can always drop down
// to the full spec when the shorthand isn't enough.
//
//   s("integer")                          -> { type: "integer" }
//   s({ pass: "boolean", note: "string" })-> object, both required, no extras
//   s({ score: "number?" })               -> object, `score` optional
//   s(["string"])                         -> array of strings
//   s({ verdict: s.enum(["passed","continue"]) })  -> enum field
//   s({ verdict: { enum: ["a","b"] } })   -> same (raw JSON Schema passthrough)

const PRIMITIVES = new Set(["string", "number", "integer", "boolean", "null"]);

function looksLikeJsonSchema(o) {
  return (
    "type" in o ||
    "properties" in o ||
    "items" in o ||
    "enum" in o ||
    "const" in o ||
    "$ref" in o ||
    "anyOf" in o ||
    "oneOf" in o ||
    "allOf" in o
  );
}

export function s(spec) {
  if (typeof spec === "string") {
    if (!PRIMITIVES.has(spec)) {
      throw new Error(
        `sandbox schema: unknown shorthand type "${spec}" — use one of ${[...PRIMITIVES].join(", ")}, or pass a raw JSON Schema object.`,
      );
    }
    return { type: spec };
  }
  if (Array.isArray(spec)) {
    return { type: "array", items: spec.length ? s(spec[0]) : {} };
  }
  if (spec && typeof spec === "object") {
    if (looksLikeJsonSchema(spec)) return spec; // already JSON Schema — leave it
    const properties = {};
    const required = [];
    for (const [key, val] of Object.entries(spec)) {
      // A trailing "?" on a shorthand type marks the field optional.
      if (typeof val === "string" && val.endsWith("?")) {
        properties[key] = s(val.slice(0, -1));
      } else {
        properties[key] = s(val);
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    };
  }
  throw new Error(`sandbox schema: cannot interpret ${JSON.stringify(spec)}`);
}

s.enum = (values) => ({ enum: values });

// ---- HTTP -----------------------------------------------------------------

async function req(method, path, body) {
  const res = await fetch(`${root}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${text || res.statusText}`,
    );
  }
  return text ? JSON.parse(text) : undefined;
}

function log(msg) {
  // Progress goes to stderr so a script's own stdout (e.g. a final result) stays
  // clean. The harness surfaces both streams to the human watching the turn.
  process.stderr.write(`[sandbox] ${msg}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- discovery ------------------------------------------------------------

/** The image catalog a sandbox may run. Each entry: { id, name, image,
 *  description }. Pass the `id` as `template` to spawn(). */
export async function listImages() {
  return (await req("GET", "/images")).images;
}

/** This driver's own connection grants: { id, name, hosts }[]. A sandbox may
 *  carry any subset of these (attenuation) and nothing more. */
export async function listConnections() {
  return (await req("GET", "/connections")).connections;
}

// ---- spawn ----------------------------------------------------------------

/** Thrown when a sandbox reports a `failed` status (silent exit past its
 *  liveness deadline, or an internal error). The loop author decides whether to
 *  retry (own try/catch) or abort (let it throw). */
export class SandboxFailed extends Error {
  constructor(id, label) {
    super(`sandbox ${label} (${id}) failed`);
    this.name = "SandboxFailed";
    this.sandboxId = id;
  }
}

/**
 * Spawn one ephemeral sandbox, deliver `prompt`, and resolve with the result the
 * sandbox reported once it passes schema validation. Create-then-poll is hidden.
 *
 * @param {object} opts
 * @param {string} [opts.template] Template id from listImages(). Preferred.
 * @param {string} [opts.image]    Full image ref (advanced). A bare name fails
 *                                 to pull, so prefer `template`.
 * @param {string[]} [opts.connections] Connection ids to grant this sandbox.
 *                                 Must be a subset of listConnections() (else 403).
 * @param {string} opts.prompt     What the sandbox should do.
 * @param {*} opts.schema          Result shape — shorthand (see `s`) or raw JSON
 *                                 Schema. The sandbox's result is validated
 *                                 against it before this resolves.
 * @param {string} [opts.label]    Log label (defaults to template/image).
 * @param {string} [opts.memory]   Memory limit, e.g. "4Gi". Raise it for a heavy
 *                                 node — the template default (often 1Gi)
 *                                 OOM-kills a clone + install + build.
 * @param {string} [opts.cpu]      CPU limit, e.g. "2" or "500m".
 * @param {number} [opts.ttlMs]    Server-side liveness deadline for this node,
 *                                 in ms. Lower it for a node that should reply
 *                                 quickly (a wedged one then fails fast); raise
 *                                 it for a heavy node that needs more than the
 *                                 default hour. Bounded server-side (~1min..6h).
 * @param {number} [opts.pollMs]   Poll interval, default 5000ms.
 * @param {number} [opts.timeoutMs] Client-side backstop. Defaults to just over
 *                                 the effective server TTL so the server's
 *                                 `failed` verdict is what you see, not a client
 *                                 timeout.
 * @returns {Promise<*>} the validated result.
 */
export async function spawn(opts = {}) {
  const {
    template,
    image,
    connections = [],
    prompt,
    schema,
    label,
    memory,
    cpu,
    ttlMs,
    pollMs = 5000,
    // Default the client backstop to 5min past the server deadline so the server
    // fails the node first; the driver then sees a real `failed`, not a timeout.
    timeoutMs = (ttlMs ?? 60 * 60 * 1000) + 5 * 60 * 1000,
  } = opts;

  if (!prompt) throw new Error("spawn: `prompt` is required");
  if (schema === undefined) {
    throw new Error(
      "spawn: `schema` is required — the result shape the sandbox must return",
    );
  }
  if (!template && !image) {
    throw new Error(
      "spawn: pass `template` (an id from listImages()) or `image` (a full ref). Prefer `template` — a bare image name fails to pull.",
    );
  }

  const body = { prompt, connections, schema: s(schema) };
  if (template) body.templateId = template;
  if (image) body.image = image;
  if (ttlMs !== undefined) body.ttlMs = ttlMs;
  if (memory !== undefined) body.memory = memory;
  if (cpu !== undefined) body.cpu = cpu;

  const { id } = await req("POST", "/invocations", body);
  const tag = label ?? template ?? image;
  log(`spawned ${tag} -> ${id}`);

  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;
  for (;;) {
    let view;
    try {
      view = await req("GET", `/invocations/${encodeURIComponent(id)}`);
      consecutiveErrors = 0;
    } catch (err) {
      // A transient poll failure shouldn't kill a long loop; give up only after
      // several in a row.
      if (++consecutiveErrors >= 5) throw err;
      await sleep(pollMs);
      continue;
    }
    if (view.status === "done") {
      log(`done ${tag} (${id})`);
      return view.result;
    }
    if (view.status === "failed") {
      log(`failed ${tag} (${id})`);
      throw new SandboxFailed(id, tag);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `spawn ${tag} (${id}) timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    await sleep(pollMs);
  }
}

/** This driver's own agent id, derived from PLATFORM_MCP_URL. */
export { agentId as driverAgentId };
