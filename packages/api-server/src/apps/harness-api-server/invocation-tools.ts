import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawnInvocationRequestSchema } from "api-server-api";
import {
  errorResult,
  json,
  run,
  textResult,
} from "../../core/mcp-tool-result.js";
import type { InvocationAwaitMarks } from "../../modules/invocations/index.js";
import type { DriverOps } from "./driver-ops.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The wait sits under Node's own 300s request
 * timeout, which the harness server does not override, for the same reason as
 * the satellite wait: a call running the full 300s would have its socket torn
 * down instead of answering "still running".
 */
export const INVOCATION_WAIT_MS = 240_000;

const POLL_MS = 2_000;

const AWAIT_MARGIN_MS = 30_000;

const MAX_AWAIT_IDS = 50;

const INVOKE_DESCRIPTION = `Invoke an agent: start a separate platform agent in its own sandbox that runs one prompt to completion unattended, reports one result matching the JSON Schema you give, and is then removed. This is not your harness's own subagent. Returns the invocation id at once; call await_invocations with it to get the result.

Prefer your harness's own subagent tool when it can do the job: it runs in this sandbox, starts in seconds and costs no extra compute. An invoked agent starts a new sandbox — tens of seconds to minutes before it runs, with compute counted against the budget — so invoke one only when the task needs one of:
- a different harness (see list_harnesses);
- its own setup: a repository to clone (seed), an install command, env;
- more CPU, memory or disk than this sandbox, or a microVM (backend "vm") for a container runtime or a cluster;
- isolation, so the work cannot touch this workspace;
- heavy parallel work beyond what this sandbox can run;
- a result the platform checks against a schema.

The invoked agent cannot ask you anything, so the prompt must let it finish on its own. It runs on your model provider; connections you pass must be your own grants (see list_connections). A setup step that fails fails the invocation at once with the reason. Do not retry this call blindly after an error: a duplicate call is a second agent.`;

const AWAIT_DESCRIPTION = `Wait for invocations you started with invoke_agent. Pass the invocation ids you are waiting on. Returns as soon as any of them finishes, or after about four minutes, listing which are done (with their result), which failed (with the reason), and which are still running. Call it again with the still-running ids to keep waiting, or end your turn: an invocation that finishes while nothing waits on it is delivered to you as a new turn. An id that is not one of your invocations comes back under unknown.`;

const spawnShape = spawnInvocationRequestSchema.shape;

const spawnInput = {
  prompt: spawnShape.prompt.describe(
    "The invoked agent's whole task. It sees only this, so include everything it needs.",
  ),
  schema: spawnShape.schema.describe(
    'JSON Schema the result must match, e.g. {"type":"integer"} or {"type":"object","properties":{"pass":{"type":"boolean"}},"required":["pass"]}. The platform checks shape only, never truth.',
  ),
  harness: spawnShape.harness.describe(
    "Harness to run on, as named by list_harnesses (e.g. claude-code). Pass this or image.",
  ),
  image: spawnShape.image.describe(
    "A custom image to run instead of the harness's template; harness then says what runs inside it.",
  ),
  label: spawnShape.label.describe(
    "Short name for the invoked agent, shown wherever agents are listed.",
  ),
  ttlMs: spawnShape.ttlMs.describe(
    "Kill deadline in ms, about 1 minute to 6 hours, default about 60 minutes. Time queued for compute counts. Short for a quick task, long for clone + build.",
  ),
  connections: spawnShape.connections.describe(
    "Connection ids to grant beyond the model, each one of your own (see list_connections).",
  ),
  seed: spawnShape.seed.describe(
    'Repository cloned into the workspace before the prompt: url, optional ref or commit, into "work" (default) or "home".',
  ),
  install: spawnShape.install.describe(
    "Shell command run once in the workspace before the prompt; must finish within 15 minutes.",
  ),
  env: spawnShape.env.describe("Environment variables, as [{name, value}]."),
  resources: spawnShape.resources.describe(
    "cpu, memory, storage (disk). Omitted values come from the harness's template; give a clone or build more memory.",
  ),
  backend: spawnShape.backend.describe(
    '"vm" to run in a microVM, when the work needs a container runtime or a cluster inside.',
  ),
  skills: spawnShape.skills.describe(
    "External skills to install: [{source, name}].",
  ),
};

type Settled =
  | { id: string; status: "done"; result: unknown }
  | { id: string; status: "failed"; reason: string | undefined }
  | { id: string; status: "running" }
  | { id: string; status: "unknown" };

async function readAll(ops: DriverOps, ids: string[]): Promise<Settled[]> {
  return Promise.all(
    ids.map(async (id): Promise<Settled> => {
      const view = await ops.get(id);
      if (!view) return { id, status: "unknown" };
      if (view.status === "done")
        return { id, status: "done", result: view.result };
      if (view.status === "failed")
        return { id, status: "failed", reason: view.errorReason };
      return { id, status: "running" };
    }),
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function summarize(settled: Settled[]) {
  return {
    done: settled.flatMap((s) =>
      s.status === "done" ? [{ id: s.id, result: s.result }] : [],
    ),
    failed: settled.flatMap((s) =>
      s.status === "failed" ? [{ id: s.id, reason: s.reason ?? null }] : [],
    ),
    running: settled.flatMap((s) => (s.status === "running" ? [s.id] : [])),
    unknown: settled.flatMap((s) => (s.status === "unknown" ? [s.id] : [])),
  };
}

export function registerInvocationTools(
  server: McpServer,
  deps: { ops: DriverOps; awaits: InvocationAwaitMarks; waitMs?: number },
): void {
  const { ops, awaits } = deps;
  const waitMs = deps.waitMs ?? INVOCATION_WAIT_MS;

  server.tool("invoke_agent", INVOKE_DESCRIPTION, spawnInput, (args) =>
    run(async () => {
      const parsed = spawnInvocationRequestSchema.safeParse(args);
      if (!parsed.success) {
        return errorResult(
          `invoke_agent refused: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
      }
      const body = parsed.data;
      const outcome = await ops.spawn(body, "tool");
      if (!outcome.ok) {
        return errorResult(`invoke_agent refused: ${outcome.message}`);
      }
      const tag = body.label ?? body.harness ?? body.image ?? outcome.id;
      return textResult(
        [
          `[invoke] spawned ${tag} -> ${outcome.id}`,
          JSON.stringify({ id: outcome.id }),
          `Call await_invocations with ["${outcome.id}"] to get its result.`,
        ].join("\n"),
      );
    }),
  );

  server.tool(
    "await_invocations",
    AWAIT_DESCRIPTION,
    {
      ids: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_AWAIT_IDS)
        .describe(
          "Invocation ids returned by invoke_agent that you are waiting on.",
        ),
    },
    ({ ids }, extra) =>
      run(async () => {
        const unique = [...new Set(ids)];
        const deadline = Date.now() + waitMs;
        await awaits.markAwaited(unique, new Date(deadline + AWAIT_MARGIN_MS));
        let settled = await readAll(ops, unique);
        while (
          !settled.some((s) => s.status === "done" || s.status === "failed") &&
          settled.some((s) => s.status === "running") &&
          Date.now() < deadline &&
          !extra.signal.aborted
        ) {
          await sleep(
            Math.min(POLL_MS, Math.max(deadline - Date.now(), 0)),
            extra.signal,
          );
          settled = await readAll(ops, unique);
        }
        const summary = summarize(settled);
        await awaits.markCollected([
          ...summary.done.map((d) => d.id),
          ...summary.failed.map((f) => f.id),
        ]);
        return json(summary);
      }),
  );

  server.tool(
    "list_harnesses",
    "List the harnesses and images an invoked agent can run on, each with its harness name and effective size. Use the harness name in invoke_agent. If it is not obvious which fits, ask the user.",
    {},
    () => run(async () => json({ images: await ops.images() })),
  );

  server.tool(
    "list_connections",
    "List your own granted connections (id, name, hosts). An invoked agent can be given any of these by id in invoke_agent's connections.",
    {},
    () => run(async () => json({ connections: await ops.connections() })),
  );

  server.tool(
    "get_budget",
    "Read your owner's compute: what is reserved now (cpu, memory) and the default worker size. Invocations past the free room queue and start as room frees, so a wide fan-out runs slower, not dead.",
    {},
    () => run(async () => json(await ops.budget())),
  );
}
