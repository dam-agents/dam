import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  InvocationOutput,
  InvocationOutputBlob,
  InvocationOutputLink,
  InvocationOutputStream,
  SpawnInvocationResponse,
  SpawnScriptInvocationRequest,
} from "api-server-api";

import { log, req } from "./http.js";
import { awaitInvocation, InvocationFailed, type Setup } from "./spawn.js";

export interface SpawnScriptOptions extends Setup {
  script: string;
  connections?: string[];
  label?: string;
  memory?: string;
  cpu?: string;
  ttlMs?: number;
  pollMs?: number;
  timeoutMs?: number;
}

export type OutputStream = InvocationOutputStream;

const MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a script sub-agent left behind: its exit
 * code and its stdout and stderr, held by the platform until read. Each read
 * checks the bytes against the sha256 the target reported and then tells the
 * platform to delete that stream, so a stream reads once; one nobody reads is
 * deleted after seven days.
 */
export class ScriptOutput {
  constructor(
    readonly invocationId: string,
    readonly exitCode: number | null,
    private readonly output: InvocationOutput,
  ) {}

  size(stream: OutputStream): number | undefined {
    return this.output[stream]?.sizeBytes;
  }

  async bytes(stream: OutputStream): Promise<Buffer> {
    const size = this.size(stream) ?? 0;
    if (size > MAX_IN_MEMORY_BYTES) {
      throw new Error(
        `invocation ${this.invocationId}: its ${stream} is ${size} bytes, too large to read into memory; use download(${JSON.stringify(stream)}, path)`,
      );
    }
    const link = await this.link(stream);
    const res = await fetch(link.url);
    if (!res.ok) throw this.fetchFailed(stream, res.status);
    const body = Buffer.from(await res.arrayBuffer());
    this.verify(stream, link, body.length, sha256(body));
    await this.ack(stream);
    return body;
  }

  async text(stream: OutputStream): Promise<string> {
    return (await this.bytes(stream)).toString("utf8");
  }

  async download(stream: OutputStream, path: string): Promise<void> {
    const link = await this.link(stream);
    const res = await fetch(link.url);
    if (!res.ok || !res.body) throw this.fetchFailed(stream, res.status);
    const hash = createHash("sha256");
    let size = 0;
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      new Transform({
        transform(chunk: Buffer, _enc, done) {
          size += chunk.length;
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(path),
    );
    this.verify(stream, link, size, hash.digest("hex"));
    await this.ack(stream);
  }

  private async link(stream: OutputStream): Promise<InvocationOutputLink> {
    if (!this.output[stream]) {
      throw new Error(
        `invocation ${this.invocationId} holds no ${stream}: it was already read, or it expired`,
      );
    }
    return req<InvocationOutputLink>("GET", this.path(stream));
  }

  private verify(
    stream: OutputStream,
    expected: InvocationOutputBlob,
    size: number,
    digest: string,
  ): void {
    if (size !== expected.sizeBytes || digest !== expected.sha256) {
      throw new Error(
        `invocation ${this.invocationId}: the ${stream} read back did not match what the script produced (${size} bytes, sha256 ${digest}; expected ${expected.sizeBytes} bytes, sha256 ${expected.sha256}); it is kept, so read it again`,
      );
    }
  }

  private async ack(stream: OutputStream): Promise<void> {
    await req("POST", `${this.path(stream)}/ack`);
    delete this.output[stream];
  }

  private fetchFailed(stream: OutputStream, status: number): Error {
    return new Error(
      `invocation ${this.invocationId}: reading its ${stream} failed with status ${status}`,
    );
  }

  private path(stream: OutputStream): string {
    return `/invocations/${encodeURIComponent(this.invocationId)}/output/${stream}`;
  }
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export class ScriptFailed extends InvocationFailed {
  constructor(
    id: string,
    label: string,
    reason: string | undefined,
    readonly output: ScriptOutput,
  ) {
    super(id, label, reason);
    this.name = "ScriptFailed";
  }
}

export async function spawnScript(
  opts: SpawnScriptOptions,
): Promise<ScriptOutput> {
  const {
    script,
    harness,
    image,
    connections = [],
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
    skills,
  } = opts;

  if (!script?.trim()) throw new Error("spawnScript: `script` is required");
  if (!harness && !image) {
    throw new Error(
      "spawnScript: pass `harness` (a name from listImages(), such as claude-code), or an `image`",
    );
  }

  const body: SpawnScriptInvocationRequest = { script, connections };
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
  if (skills) body.skills = skills;

  const { id } = await req<SpawnInvocationResponse>(
    "POST",
    "/invocations",
    body,
  );
  const tag = label ?? harness ?? image ?? id;
  log(`spawned ${tag} -> ${id}`);

  const view = await awaitInvocation(id, tag, { pollMs, timeoutMs });
  const output = new ScriptOutput(id, view.exitCode ?? null, view.output ?? {});
  if (view.status === "failed") {
    log(
      `failed ${tag} (${id})${view.errorReason ? `: ${view.errorReason}` : ""}`,
    );
    throw new ScriptFailed(id, tag, view.errorReason, output);
  }
  log(`done ${tag} (${id})`);
  return output;
}
