import type {
  SpawnInvocationRequest,
  SpawnInvocationResponse,
  InvocationView,
} from "api-server-api";
import { req, log, sleep } from "./http.js";
import { s, type JsonSchema, type SchemaSpec } from "./schema.js";

// ---- discovery ------------------------------------------------------------

/** One entry in the image catalog an Invocation may run. Pass `id` as `template`. */
export interface ImageInfo {
  id: string;
  name: string;
  image: string;
  description?: string;
}

/** One of this driver's connection grants. An Invocation may carry any subset. */
export interface ConnectionInfo {
  id: string;
  name: string;
  hosts: string[];
}

/** The image catalog an Invocation may run. Pass the `id` as `template` to
 *  spawn(). */
export async function listImages(): Promise<ImageInfo[]> {
  return (await req<{ images: ImageInfo[] }>("GET", "/images")).images;
}

/** This driver's own connection grants. An Invocation may carry any subset of
 *  these (attenuation) and nothing more. */
export async function listConnections(): Promise<ConnectionInfo[]> {
  return (await req<{ connections: ConnectionInfo[] }>("GET", "/connections"))
    .connections;
}

// ---- spawn ----------------------------------------------------------------

/** Thrown when an Invocation reports a `failed` status (silent exit past its
 *  liveness deadline, or an internal error). The loop author decides whether to
 *  retry (own try/catch) or abort (let it throw). */
export class InvocationFailed extends Error {
  readonly invocationId: string;
  constructor(id: string, label: string) {
    super(`invocation ${label} (${id}) failed`);
    this.name = "InvocationFailed";
    this.invocationId = id;
  }
}

export interface SpawnOptions {
  /** Template id from listImages(). Preferred. */
  template?: string;
  /** Full image ref (advanced). A bare name fails to pull, so prefer `template`. */
  image?: string;
  /** Connection ids to grant this Invocation. Must be a subset of
   *  listConnections() (else 403). */
  connections?: string[];
  /** What the Invocation should do. */
  prompt: string;
  /** Result shape — shorthand (see `s`) or raw JSON Schema. The result is
   *  validated against it before this resolves. */
  schema: SchemaSpec;
  /** Log label (defaults to template/image). */
  label?: string;
  /** Memory limit, e.g. "4Gi". Raise it for a heavy node — the template default
   *  (often 1Gi) OOM-kills a clone + install + build. */
  memory?: string;
  /** CPU limit, e.g. "2" or "500m". */
  cpu?: string;
  /** Server-side liveness deadline for this node, in ms. Lower it for a node
   *  that should reply quickly (a wedged one then fails fast); raise it for a
   *  heavy node that needs more than the default hour. Bounded server-side
   *  (~1min..6h). */
  ttlMs?: number;
  /** Poll interval, default 5000ms. */
  pollMs?: number;
  /** Client-side backstop. Defaults to just over the effective server TTL so the
   *  server's `failed` verdict is what you see, not a client timeout. */
  timeoutMs?: number;
}

/**
 * Spawn one ephemeral Invocation, deliver `prompt`, and resolve with the result
 * it reported once it passes schema validation. Create-then-poll is hidden.
 */
export async function spawn<T = unknown>(opts: SpawnOptions): Promise<T> {
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
      "spawn: `schema` is required — the result shape the Invocation must return",
    );
  }
  if (!template && !image) {
    throw new Error(
      "spawn: pass `template` (an id from listImages()) or `image` (a full ref). Prefer `template` — a bare image name fails to pull.",
    );
  }

  const body: SpawnInvocationRequest = {
    prompt,
    connections,
    schema: s(schema) as JsonSchema,
  };
  if (template) body.templateId = template;
  if (image) body.image = image;
  if (ttlMs !== undefined) body.ttlMs = ttlMs;
  if (memory !== undefined) body.memory = memory;
  if (cpu !== undefined) body.cpu = cpu;

  const { id } = await req<SpawnInvocationResponse>(
    "POST",
    "/invocations",
    body,
  );
  const tag = label ?? template ?? image ?? id;
  log(`spawned ${tag} -> ${id}`);

  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;
  for (;;) {
    let view: InvocationView;
    try {
      view = await req<InvocationView>(
        "GET",
        `/invocations/${encodeURIComponent(id)}`,
      );
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
      return view.result as T;
    }
    if (view.status === "failed") {
      log(`failed ${tag} (${id})`);
      throw new InvocationFailed(id, tag);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `spawn ${tag} (${id}) timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    await sleep(pollMs);
  }
}
