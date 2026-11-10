import type {
  ChildEgressRule,
  SpawnInvocationResponse,
  SpawnScriptInvocationRequest,
} from "api-server-api";
import { log, req, spawningSessionHeaders } from "./http.js";
import { s, type SchemaSpec } from "./schema.js";
import { ScriptFailed, ScriptOutput } from "./script.js";
import {
  awaitInvocation,
  defaultTimeoutMs,
  inheritanceBody,
  InvocationFailed,
  type Inheritance,
  type Setup,
} from "./spawn.js";

export interface SpawnSlateOptions extends Setup, Inheritance {
  label?: string;
  ttlMs?: number;
}

export interface RunOptions {
  ttlMs?: number;
  pollMs?: number;
  timeoutMs?: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a sub-agent this driver works in rather than
 * fires once: spawned as a clean slate that runs nothing, entered over the link
 * (`ssh sub-<id>`, `scp`) to put files in and take them out, and given runs, a
 * prompt with its schema or a script, each on the same machine with its files.
 * Without keep it is removed after its first result; with keep it takes runs
 * until its keep expiry, which keep() moves. Its own Environments go with it
 * when it is removed. A kept one takes several runs at once, each awaited on
 * its own. A prompt run continues the conversation of the latest prompt run
 * unless it names another session (lastSession holds the one each run ran
 * in), or "new" for a fresh one.
 */
export class SubAgent {
  lastSession: string | undefined;

  constructor(
    readonly id: string,
    private readonly tag: string,
  ) {}

  async run<T = unknown>(
    task: {
      prompt: string;
      schema: SchemaSpec;
      model?: string;
      session?: string;
    },
    opts: RunOptions = {},
  ): Promise<T> {
    const view = await this.start(
      {
        prompt: task.prompt,
        schema: s(task.schema),
        ...(task.model ? { model: task.model } : {}),
        ...(task.session ? { session: task.session } : {}),
      },
      opts,
    );
    if (view.session) this.lastSession = view.session;
    if (view.status === "failed")
      throw new InvocationFailed(this.id, this.tag, view.errorReason);
    return view.result as T;
  }

  async runScript(
    script: string,
    opts: RunOptions = {},
  ): Promise<ScriptOutput> {
    const view = await this.start({ script }, opts);
    const output = new ScriptOutput(
      view.run ?? this.id,
      view.exitCode ?? null,
      view.output ?? {},
    );
    if (view.status === "failed")
      throw new ScriptFailed(this.id, this.tag, view.errorReason, output);
    return output;
  }

  async keep(
    keepForMs?: number,
    opts: { idleTimeoutMin?: number } = {},
  ): Promise<Date> {
    const { keepUntil } = await req<{ keepUntil: string }>(
      "POST",
      `/invocations/${encodeURIComponent(this.id)}/keep`,
      {
        ...(keepForMs !== undefined ? { keepForMs } : {}),
        ...(opts.idleTimeoutMin !== undefined
          ? { idleTimeoutMin: opts.idleTimeoutMin }
          : {}),
      },
    );
    return new Date(keepUntil);
  }

  async wake(): Promise<void> {
    await req("POST", `/invocations/${encodeURIComponent(this.id)}/wake`, {});
  }

  async setEgress(rules: ChildEgressRule[]): Promise<void> {
    await req("POST", `/invocations/${encodeURIComponent(this.id)}/egress`, {
      rules,
    });
  }

  private async start(body: Record<string, unknown>, opts: RunOptions) {
    const { ttlMs, pollMs = 5000, timeoutMs = defaultTimeoutMs(ttlMs) } = opts;
    const { run } = await req<{ run: string }>(
      "POST",
      `/invocations/${encodeURIComponent(this.id)}/run`,
      { ...body, ...(ttlMs !== undefined ? { ttlMs } : {}) },
    );
    log(`run ${run} started in ${this.tag} (${this.id})`);
    return awaitInvocation(run, this.tag, { pollMs, timeoutMs });
  }
}

export async function spawnSlate(opts: SpawnSlateOptions): Promise<SubAgent> {
  const {
    harness,
    image,
    label,
    ttlMs,
    seed,
    install,
    env,
    resources,
    skills,
  } = opts;
  if (!harness && !image) {
    throw new Error(
      "spawnSlate: pass `harness` (a name from listImages(), such as claude-code), or an `image`",
    );
  }
  const body: Omit<SpawnScriptInvocationRequest, "script"> = {
    ...inheritanceBody(opts),
    ...(harness ? { harness } : {}),
    ...(image ? { image } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(ttlMs !== undefined ? { ttlMs } : {}),
    ...(seed ? { seed } : {}),
    ...(install ? { install } : {}),
    ...(env ? { env } : {}),
    ...(resources ? { resources } : {}),
    ...(skills ? { skills } : {}),
  };
  const { id } = await req<SpawnInvocationResponse>(
    "POST",
    "/invocations",
    body,
    spawningSessionHeaders(),
  );
  const tag = label ?? harness ?? image ?? id;
  log(`spawned clean slate ${tag} -> ${id}`);
  opts.onSpawned?.(id);
  return new SubAgent(id, tag);
}

export function subAgent(id: string): SubAgent {
  return new SubAgent(id, id);
}
