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
  harness?: string;
  size?: { cpu: string; memory: string };
}

export interface ConnectionInfo {
  id: string;
  name: string;
  hosts: string[];
}

export interface Budget {
  cpu: { reservedMilli: number; ceilingMilli: number };
  memory: { reservedBytes: number; ceilingBytes: number };
  defaultWorkerSize: { cpu: string; memory: string };
}

export async function listImages(): Promise<ImageInfo[]> {
  return (await req<{ images: ImageInfo[] }>("GET", "/images")).images;
}

export async function listConnections(): Promise<ConnectionInfo[]> {
  return (await req<{ connections: ConnectionInfo[] }>("GET", "/connections"))
    .connections;
}

export async function budget(): Promise<Budget> {
  return req<Budget>("GET", "/budget");
}

export class InvocationFailed extends Error {
  readonly invocationId: string;
  readonly reason: string | undefined;
  constructor(id: string, label: string, reason?: string) {
    super(`invocation ${label} (${id}) failed${reason ? `: ${reason}` : ""}`);
    this.name = "InvocationFailed";
    this.invocationId = id;
    this.reason = reason;
  }
}

type Setup = Pick<
  SpawnInvocationRequest,
  | "harness"
  | "image"
  | "seed"
  | "install"
  | "env"
  | "resources"
  | "backend"
  | "skills"
>;

export interface SpawnOptions extends Setup {
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
    harness,
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
    seed,
    install,
    env,
    resources,
    backend,
    skills,
  } = opts;

  if (!prompt) throw new Error("spawn: `prompt` is required");
  if (schema === undefined) {
    throw new Error(
      "spawn: `schema` is required — the result shape the Invocation must return",
    );
  }
  if (!harness && !image) {
    throw new Error(
      "spawn: pass `harness` (a name from listImages(), such as claude-code), or an `image`",
    );
  }

  const body: SpawnInvocationRequest = {
    prompt,
    connections,
    schema: s(schema) as JsonSchema,
  };
  if (harness) body.harness = harness;
  if (image) body.image = image;
  if (label !== undefined) body.label = label;
  if (ttlMs !== undefined) body.ttlMs = ttlMs;
  if (memory !== undefined) body.memory = memory;
  if (cpu !== undefined) body.cpu = cpu;
  if (seed) body.seed = seed;
  if (install) body.install = install;
  if (env) body.env = env;
  if (resources) body.resources = resources;
  if (backend) body.backend = backend;
  if (skills) body.skills = skills;

  const { id } = await req<SpawnInvocationResponse>(
    "POST",
    "/invocations",
    body,
  );
  const tag = label ?? harness ?? image ?? id;
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
      log(
        `failed ${tag} (${id})${view.errorReason ? `: ${view.errorReason}` : ""}`,
      );
      throw new InvocationFailed(id, tag, view.errorReason);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `spawn ${tag} (${id}) timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
    }
    await sleep(pollMs);
  }
}
