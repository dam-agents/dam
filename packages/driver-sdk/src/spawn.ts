import type {
  SpawnInvocationRequest,
  SpawnInvocationResponse,
  InvocationView,
} from "api-server-api";
import { req, log, sleep } from "./http.js";
import { s, type JsonSchema, type SchemaSpec } from "./schema.js";

export interface ImageInfo {
  id: string;
  name: string;
  image: string;
  description?: string;
}

export interface ConnectionInfo {
  id: string;
  name: string;
  hosts: string[];
}

export async function listImages(): Promise<ImageInfo[]> {
  return (await req<{ images: ImageInfo[] }>("GET", "/images")).images;
}

export async function listConnections(): Promise<ConnectionInfo[]> {
  return (await req<{ connections: ConnectionInfo[] }>("GET", "/connections"))
    .connections;
}

export class InvocationFailed extends Error {
  readonly invocationId: string;
  constructor(id: string, label: string) {
    super(`invocation ${label} (${id}) failed`);
    this.name = "InvocationFailed";
    this.invocationId = id;
  }
}

export interface SpawnOptions {
  template?: string;
  image?: string;
  connections?: string[];
  prompt: string;
  schema: SchemaSpec;
  label?: string;
  memory?: string;
  cpu?: string;
  ttlMs?: number;
  pollMs?: number;
  timeoutMs?: number;
}

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
