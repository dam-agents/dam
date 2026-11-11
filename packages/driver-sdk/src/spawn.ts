import type {
  SpawnInvocationRequest,
  InvocationView,
  StopInvocationRequest,
  StopInvocationResponse,
} from "api-server-api";
import { req, log, sleep, spawnInvocation } from "./http.js";
import { s, type SchemaSpec } from "./schema.js";

export interface ImageInfo {
  id: string;
  name: string;
  image: string;
  description?: string;
  harness?: string;
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
  readonly reason: string | undefined;
  constructor(id: string, label: string, reason?: string) {
    super(`invocation ${label} (${id}) failed${reason ? `: ${reason}` : ""}`);
    this.name = "InvocationFailed";
    this.invocationId = id;
    this.reason = reason;
  }
}

export class Stopped extends Error {
  readonly invocationId: string | undefined;
  constructor(id: string | undefined, label: string, cause: unknown) {
    super(`invocation ${id ? `${label} (${id})` : label} stopped`, { cause });
    this.name = "Stopped";
    this.invocationId = id;
  }
}

const SCRIPT_STOP_REASON = "its script aborted the spawn";

// UNIT_BOUNDARY_DESCRIPTION: the reason an aborted spawn is stopped with: the signal's string reason, or, for a kept one, which is stopped only with a reason, one that says the script aborted it.
function abortReason(
  signal: AbortSignal,
  keep: boolean | undefined,
): string | undefined {
  const why: unknown = signal.reason;
  const given = typeof why === "string" ? why.trim() : "";
  return given || (keep ? SCRIPT_STOP_REASON : undefined);
}

export type Setup = Pick<
  SpawnInvocationRequest,
  "harness" | "image" | "seed" | "install" | "env" | "resources" | "skills"
>;

// UNIT_BOUNDARY_DESCRIPTION: a signal that stops a one-off sub-agent when it aborts, and every sub-agent it started in turn; the call then throws Stopped, with the signal's reason as its cause, and an abort before the spawn spawns nothing. A string reason (abort("why")) is the stop's reason, which the user reads.
export interface Stoppable {
  signal?: AbortSignal;
}

// UNIT_BOUNDARY_DESCRIPTION: what a sub-agent takes from this driver and how long it stays: its connections ("none", the default, only its model; "parent", all of the driver's kept in step; or ids copied once), its egress ("parent", the default; "open" or {open: rules}; {scoped: hosts}), and with keep, that it outlives its result until keepForMs, sleeping after idleTimeoutMin minutes idle (the install's default otherwise). onSpawned gets its id at once, so a kept one can be entered or run in later.
export interface Inheritance {
  connections?: SpawnInvocationRequest["connections"];
  egress?: SpawnInvocationRequest["egress"];
  keep?: boolean;
  keepForMs?: number;
  idleTimeoutMin?: number;
  onSpawned?: (id: string) => void;
}

export function inheritanceBody(
  opts: Inheritance,
): Pick<
  SpawnInvocationRequest,
  "connections" | "egress" | "keep" | "keepForMs" | "idleTimeoutMin"
> {
  return {
    ...(opts.connections !== undefined
      ? { connections: opts.connections }
      : {}),
    ...(opts.egress !== undefined ? { egress: opts.egress } : {}),
    ...(opts.keep ? { keep: true } : {}),
    ...(opts.keepForMs !== undefined ? { keepForMs: opts.keepForMs } : {}),
    ...(opts.idleTimeoutMin !== undefined
      ? { idleTimeoutMin: opts.idleTimeoutMin }
      : {}),
  };
}

export interface SpawnOptions extends Setup, Inheritance, Stoppable {
  prompt: string;
  schema: SchemaSpec;
  label?: string;
  model?: string;
  mode?: string;
  configOptions?: Record<string, string>;
  ttlMs?: number;
  pollMs?: number;
  timeoutMs?: number;
}

export async function spawn<T = unknown>(opts: SpawnOptions): Promise<T> {
  const {
    harness,
    image,
    prompt,
    schema,
    label,
    model,
    mode,
    configOptions,
    ttlMs,
    pollMs = 5000,
    timeoutMs = defaultTimeoutMs(ttlMs),
    seed,
    install,
    env,
    resources,
    skills,
    signal,
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
    schema: s(schema),
    ...inheritanceBody(opts),
  };
  if (harness) body.harness = harness;
  if (image) body.image = image;
  if (label !== undefined) body.label = label;
  if (ttlMs !== undefined) body.ttlMs = ttlMs;
  if (seed) body.seed = seed;
  if (install) body.install = install;
  if (env) body.env = env;
  if (resources) body.resources = resources;
  if (skills) body.skills = skills;
  const options =
    configOptions && Object.keys(configOptions).length > 0
      ? configOptions
      : undefined;
  if (model !== undefined || mode !== undefined || options !== undefined) {
    body.harnessConfig = {
      ...(model !== undefined ? { model } : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(options !== undefined ? { configOptions: options } : {}),
    };
  }

  if (signal?.aborted)
    throw new Stopped(undefined, label ?? "spawn", signal.reason);
  const id = await spawnInvocation(body);
  const tag = label ?? harness ?? image ?? id;
  log(`spawned ${tag} -> ${id}`);
  opts.onSpawned?.(id);

  const view = await awaitInvocation(id, tag, {
    pollMs,
    timeoutMs,
    signal,
    keep: opts.keep,
  });
  if (view.status === "failed") {
    log(
      `failed ${tag} (${id})${view.errorReason ? `: ${view.errorReason}` : ""}`,
    );
    throw new InvocationFailed(id, tag, view.errorReason);
  }
  log(`done ${tag} (${id})`);
  return view.result as T;
}

export function defaultTimeoutMs(ttlMs: number | undefined): number {
  return 2 * (ttlMs ?? 60 * 60 * 1000) + 5 * 60 * 1000;
}

export async function awaitInvocation(
  id: string,
  tag: string,
  opts: {
    pollMs: number;
    timeoutMs: number;
    signal?: AbortSignal;
    keep?: boolean;
  },
): Promise<InvocationView & { status: "done" | "failed" }> {
  const deadline = Date.now() + opts.timeoutMs;
  let consecutiveErrors = 0;
  let waiting: string | undefined;
  for (;;) {
    if (opts.signal?.aborted) {
      await stopInvocation(id, abortReason(opts.signal, opts.keep));
      log(`stopped ${tag} (${id})`);
      throw new Stopped(id, tag, opts.signal.reason);
    }
    let view: InvocationView;
    try {
      view = await req<InvocationView>(
        "GET",
        `/invocations/${encodeURIComponent(id)}`,
      );
      consecutiveErrors = 0;
    } catch (err) {
      if (++consecutiveErrors >= 5) throw err;
      await sleep(opts.pollMs, opts.signal);
      continue;
    }
    if (view.status === "done" || view.status === "failed")
      return { ...view, status: view.status };
    if (view.waiting !== waiting) {
      waiting = view.waiting;
      if (waiting) log(`${tag} (${id}) waits for room to start: ${waiting}`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `spawn ${tag} (${id}) timed out after ${Math.round(opts.timeoutMs / 1000)}s`,
      );
    }
    await sleep(opts.pollMs, opts.signal);
  }
}

const MAX_STOP_REASON_CHARS = 500;

export async function stopInvocation(
  id: string,
  reason?: string,
): Promise<boolean> {
  const why = reason?.trim().slice(0, MAX_STOP_REASON_CHARS).trim();
  const body: StopInvocationRequest = why ? { reason: why } : {};
  const { stopped } = await req<StopInvocationResponse>(
    "POST",
    `/invocations/${encodeURIComponent(id)}/stop`,
    body,
  );
  return stopped;
}
