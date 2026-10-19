import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  platformSubagentChoice,
  type SessionSubAgentContext,
} from "agent-runtime-api";
import {
  formatQualifiedModel,
  parseQualifiedModel,
  spawnInvocationRequestSchema,
} from "api-server-api";
import {
  errorResult,
  json,
  run,
  textResult,
} from "../../core/mcp-tool-result.js";
import type { SubAgentAwaitMarks } from "../../modules/invocations/index.js";
import type { DriverOps, SpawnRequest } from "./driver-ops.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The wait sits under Node's own 300s request
 * timeout, which the harness server does not override, for the same reason as
 * the satellite wait: a call running the full 300s would have its socket torn
 * down instead of answering "still running".
 */
export const SUB_AGENT_WAIT_MS = 240_000;

const POLL_MS = 2_000;

const PROGRESS_INTERVAL_MS = 20_000;

const AWAIT_AGAIN_GRACE_MS = 60_000;

const LEASE_POLLS = 4;

const MAX_AWAIT_IDS = 50;

const SPAWN_DESCRIPTION = `Spawn a platform sub-agent: a separate agent in its own new sandbox. This is not your harness's own subagent: if your harness has one, it runs here, starts in seconds and costs no extra compute, so prefer it whenever it can do the job. A platform sub-agent takes tens of seconds to minutes to start and its compute counts against the budget, so spawn one only when the task needs something only a separate sandbox gives, and name it in needs:
- different-harness: it must run on another harness (see list_harnesses);
- own-setup: it needs its own repository (seed), install command, env or skills;
- more-resources: more CPU, memory or disk than this sandbox, or a microVM (backend "vm") for a container runtime or a cluster;
- isolation: the work must not be able to touch this workspace;
- parallel: heavy parallel work beyond what this sandbox can run;
- checked-result: a result the platform validates against a schema.
A need the request does not bear out is refused: different-harness on your own harness, own-setup without seed, install, env or skills, more-resources without resources or a vm backend.

The sub-agent runs one prompt to completion unattended, reports one result matching the JSON Schema you give, and is then removed. It cannot ask you anything, so the prompt must let it finish on its own. It runs on one of your model providers that its harness runs on (list_harnesses shows which, or what is missing); connections you pass must be your own grants (see list_connections). The user may set this session's platform sub-agents to a harness, model, mode or config option: those then bind, and the result names them. A setup step that fails fails the sub-agent at once with the reason. Returns the sub-agent id at once; call await_subagents with it to get the result. Do not retry this call blindly after an error: a duplicate call is a second sub-agent.`;

const AWAIT_DESCRIPTION = `Wait for sub-agents you started with spawn_subagent. Returns as soon as any of them finishes, or after about four minutes, listing which are done (with their result), which failed (with the reason), and which are still running. Call it again with the still-running ids to keep waiting, or end your turn: a sub-agent that finishes while nothing waits on it is delivered to you as a new turn. An id that is not one of your sub-agents comes back under unknown. If the call itself fails with a connection or transport error, the sub-agents keep running: call it again with the same ids.`;

const spawnShape = spawnInvocationRequestSchema.shape;

export const SPAWN_NEEDS = [
  "different-harness",
  "own-setup",
  "more-resources",
  "isolation",
  "parallel",
  "checked-result",
] as const;
export type SpawnNeed = (typeof SPAWN_NEEDS)[number];

const needsInput = z
  .array(z.enum(SPAWN_NEEDS))
  .min(1)
  .describe("Why this needs a separate sandbox instead of this one.");

const spawnInput = {
  needs: needsInput,
  prompt: spawnShape.prompt.describe(
    "The sub-agent's whole task. It sees only this, so include everything it needs.",
  ),
  schema: spawnShape.schema.describe(
    'JSON Schema the result must match, e.g. {"type":"integer"} or {"type":"object","properties":{"pass":{"type":"boolean"}},"required":["pass"]}. The platform checks shape only, never truth.',
  ),
  harness: spawnShape.harness.describe(
    "Harness to run on, as named by list_harnesses (e.g. claude-code). Pass this or image; with neither, the harness the user set for this session's platform sub-agents.",
  ),
  image: spawnShape.image.describe(
    "A custom image to run instead of the default one. Pass harness too only when the image carries that harness.",
  ),
  label: spawnShape.label.describe(
    "Short name for the sub-agent, shown wherever agents are listed.",
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
  model: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Model the sub-agent runs, provider-qualified (ibm/gpt-5.5, claude/ibm/aws/claude-sonnet-5-5 on claude-code). Ignored when the user set a model for this session's platform sub-agents. It must be a model this agent's providers list for the target harness; the refusal names the listed ones. Unset, this session's model on your own harness, else the harness's default model.",
    ),
  mode: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Harness mode, as the Config panel names it. Leave unset unless you know the harness: a mode that asks for approvals stalls an unattended sub-agent. claude-code on haiku needs bypassPermissions, or its report_result waits for an approval until the deadline.",
    ),
  configOptions: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Harness config options as {name: value}: effort on claude-code (low to xhigh; haiku takes none) and codex (minimal to xhigh), approvals on bob. A setting the harness cannot apply fails the sub-agent as soon as it boots.",
    ),
};

function schemaFromText(schema: unknown): unknown {
  if (typeof schema !== "string") return schema;
  try {
    return JSON.parse(schema) as unknown;
  } catch {
    return schema;
  }
}

function withHarnessConfig<T extends object>(
  rest: T & {
    model?: string;
    mode?: string;
    configOptions?: Record<string, string>;
  },
): object {
  const { model, mode, configOptions, ...body } = rest;
  const options =
    configOptions && Object.keys(configOptions).length > 0
      ? configOptions
      : undefined;
  if (model === undefined && mode === undefined && options === undefined)
    return body;
  return {
    ...body,
    harnessConfig: {
      ...(model !== undefined ? { model } : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(options !== undefined ? { configOptions: options } : {}),
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The part of a stated need the request itself can
 * bear out. It cannot judge isolation, parallel or checked-result, so those
 * pass; a need whose evidence would be in the request and is missing is
 * refused, so the model cannot name a need it did not act on.
 */
export function unmetNeed(
  needs: readonly SpawnNeed[],
  body: SpawnRequest,
  ownHarness: string | null,
): string | null {
  if (needs.includes("different-harness")) {
    if (!body.harness) return "different-harness names no harness";
    if (ownHarness && body.harness === ownHarness)
      return `different-harness, but ${ownHarness} is your own harness`;
  }
  if (
    needs.includes("own-setup") &&
    !body.seed &&
    !body.install &&
    !body.env?.length &&
    !body.skills?.length
  )
    return "own-setup without seed, install, env or skills";
  if (
    needs.includes("more-resources") &&
    !body.resources &&
    body.cpu === undefined &&
    body.memory === undefined &&
    body.backend !== "vm"
  )
    return "more-resources without resources or a vm backend";
  return null;
}

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

type SpawnArgs = {
  harness?: string | undefined;
  image?: string | undefined;
  model?: string | undefined;
  mode?: string | undefined;
  configOptions?: Record<string, string> | undefined;
};

export type ResolvedSubAgent =
  | {
      ok: true;
      harness?: string;
      model?: string;
      mode?: string;
      configOptions?: Record<string, string>;
      modelFrom?: "setting" | "spawn" | "session";
      bound: string[];
    }
  | { ok: false; message: string };

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a platform sub-agent runs on, setting by
 * setting. The session's platform sub-agent settings bind: a spawn on
 * another harness is refused, a spawn naming none gets the set one, and a
 * set model, mode or config option outranks the spawn's. Below them the
 * spawn's own choice, then, on the session's own harness, the session's
 * model and settings, then the harness defaults. A spawn on an image alone
 * keeps its own choices.
 */
export function resolveSubAgent(
  args: SpawnArgs,
  session: SessionSubAgentContext | null,
): ResolvedSubAgent {
  const set = session ? platformSubagentChoice(session.settings) : null;
  if (set?.harness && args.harness && args.harness !== set.harness)
    return {
      ok: false,
      message: `this session's platform sub-agent setting runs every sub-agent on ${set.harness}, not ${args.harness}. Spawn on ${set.harness}, or ask the user to change the setting`,
    };
  const harness =
    args.harness ?? (args.image ? undefined : (set?.harness ?? undefined));
  const bound = set?.harness && harness === set.harness ? set : null;
  const inherited =
    harness !== undefined && harness === session?.harness
      ? (session.inherited ?? {})
      : {};
  const modelFrom = bound?.model
    ? "setting"
    : args.model !== undefined
      ? "spawn"
      : inherited.model !== undefined
        ? "session"
        : undefined;
  const model =
    canonicalModel(bound?.model) ??
    canonicalModel(args.model) ??
    inherited.model;
  const mode = bound?.mode ?? args.mode ?? inherited.mode;
  const configOptions = {
    ...inherited.configOptions,
    ...args.configOptions,
    ...bound?.configOptions,
  };
  return {
    ok: true,
    ...(harness !== undefined && { harness }),
    ...(model !== undefined && { model }),
    ...(mode !== undefined && { mode }),
    ...(Object.keys(configOptions).length > 0 && { configOptions }),
    ...(modelFrom && { modelFrom }),
    bound: bound
      ? [
          `harness ${bound.harness}`,
          ...(bound.model ? [`model ${canonicalModel(bound.model)}`] : []),
          ...(bound.mode ? [`mode ${bound.mode}`] : []),
          ...Object.entries(bound.configOptions ?? {}).map(
            ([id, value]) => `${id} ${value}`,
          ),
        ]
      : [],
  };
}

export class SessionSettingsUnreadableError extends Error {
  constructor() {
    super("the spawning session's settings could not be read");
    this.name = "SessionSettingsUnreadableError";
  }
}

// UNIT_BOUNDARY_DESCRIPTION: a model named the way Claude Code spells it (`claude/<alias>/<id>`) folds to the provider-qualified form the spawn route takes; a bare name stays as it is, for the route to refuse by name.
const canonicalModel = (model: string | undefined): string | undefined => {
  const parsed = parseQualifiedModel(model, { claudePrefix: true });
  return parsed ? formatQualifiedModel(parsed.alias, parsed.upstreamId) : model;
};

export interface CatalogModelRef {
  alias: string;
  upstreamId: string;
  name: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a model the agent's catalog does not list for
 * the target harness is refused before anything is created, naming what is
 * listed: a sub-agent on a model its harness refuses would otherwise sit
 * until its deadline. A harness the catalog has no view for is not checked.
 */
function unlistedModel(
  model: string,
  listed: readonly CatalogModelRef[] | null,
): string | null {
  if (listed === null) return null;
  const wanted = parseQualifiedModel(model, { claudePrefix: true });
  const found =
    wanted !== null &&
    listed.some(
      (m) =>
        m.alias === wanted.alias &&
        m.upstreamId.toLowerCase() === wanted.upstreamId.toLowerCase(),
    );
  if (found) return null;
  const names = listed.map((m) => m.name);
  return `no granted provider lists ${model} for that harness; listed: ${names.length > 0 ? names.join(", ") : "none"}`;
}

export function registerSubAgentTools(
  server: McpServer,
  deps: {
    ops: DriverOps;
    awaits: SubAgentAwaitMarks;
    spawningSession: () => Promise<string | null>;
    requestSignal?: AbortSignal;
    sessionContext?: () => Promise<SessionSubAgentContext | null>;
    catalogModels?: (harness: string) => Promise<CatalogModelRef[] | null>;
    waitMs?: number;
    pollMs?: number;
  },
): void {
  const { ops, awaits, requestSignal } = deps;
  const waitMs = deps.waitMs ?? SUB_AGENT_WAIT_MS;
  const pollMs = deps.pollMs ?? POLL_MS;

  server.tool("spawn_subagent", SPAWN_DESCRIPTION, spawnInput, (args) =>
    run(async () => {
      const { needs, ...rest } = args;
      let session: SessionSubAgentContext | null;
      try {
        session = (await deps.sessionContext?.()) ?? null;
      } catch (err) {
        if (!(err instanceof SessionSettingsUnreadableError)) throw err;
        return errorResult(
          "spawn_subagent refused: this session's settings could not be read, so its platform sub-agent settings cannot be applied. Try again.",
        );
      }
      const resolved = resolveSubAgent(rest, session);
      if (!resolved.ok)
        return errorResult(`spawn_subagent refused: ${resolved.message}`);
      const { ok: _ok, bound, modelFrom, ...choice } = resolved;
      const parsed = spawnInvocationRequestSchema.safeParse(
        withHarnessConfig({
          ...rest,
          ...choice,
          schema: schemaFromText(rest.schema),
        }),
      );
      if (!parsed.success) {
        return errorResult(
          `spawn_subagent refused: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
      }
      const body = parsed.data;
      if (
        choice.model &&
        modelFrom !== "session" &&
        body.harness &&
        deps.catalogModels
      ) {
        const unlisted = unlistedModel(
          choice.model,
          await deps.catalogModels(body.harness),
        );
        if (unlisted)
          return errorResult(
            modelFrom === "setting"
              ? `spawn_subagent refused: this session's platform sub-agent setting names ${choice.model}, and ${unlisted}. Ask the user to change the setting.`
              : `spawn_subagent refused: ${unlisted}`,
          );
      }
      const [harness, driverSessionId] = await Promise.all([
        session?.harness ? Promise.resolve(session.harness) : ops.harness(),
        deps.spawningSession(),
      ]);
      const unmet = unmetNeed(needs, body, harness);
      if (unmet) {
        return errorResult(
          `spawn_subagent refused: ${unmet}. Do the work in this sandbox, with your harness's own subagent if it has one, or state a need the request bears out.`,
        );
      }
      const outcome = await ops.spawn(body, {
        origin: "tool",
        driverSessionId,
      });
      if (!outcome.ok) {
        return errorResult(`spawn_subagent refused: ${outcome.message}`);
      }
      const tag = body.label ?? body.harness ?? body.image ?? outcome.id;
      return textResult(
        [
          `[invoke] spawned ${tag} -> ${outcome.id}`,
          `needs: ${needs.join(", ")}`,
          ...(bound.length > 0
            ? [
                `set by this session's platform sub-agent settings: ${bound.join(", ")} (arguments for these are ignored)`,
              ]
            : []),
          JSON.stringify({ id: outcome.id }),
          `Call await_subagents with ["${outcome.id}"] to get its result.`,
        ].join("\n"),
      );
    }),
  );

  server.tool(
    "await_subagents",
    AWAIT_DESCRIPTION,
    {
      ids: z
        .array(z.string().min(1))
        .min(1)
        .max(MAX_AWAIT_IDS)
        .describe(
          "Sub-agent ids returned by spawn_subagent that you are waiting on.",
        ),
    },
    ({ ids }, extra) =>
      run(async () => {
        const unique = [...new Set(ids)];
        const deadline = Date.now() + waitMs;
        const signal = requestSignal
          ? AbortSignal.any([extra.signal, requestSignal])
          : extra.signal;
        const lease = () =>
          awaits.markAwaited(
            unique,
            new Date(Date.now() + pollMs * LEASE_POLLS),
          );
        const progressToken = extra._meta?.progressToken;
        let beats = 0;
        let lastBeat = Date.now();
        const heartbeat = async (settled: Settled[]) => {
          if (
            progressToken === undefined ||
            Date.now() - lastBeat < PROGRESS_INTERVAL_MS
          )
            return;
          lastBeat = Date.now();
          beats += 1;
          const running = settled.filter((s) => s.status === "running").length;
          await extra
            .sendNotification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: beats,
                message: `Still waiting: ${running} running`,
              },
            })
            .catch(() => {});
        };
        await lease();
        let settled = await readAll(ops, unique);
        while (
          !settled.some((s) => s.status === "done" || s.status === "failed") &&
          settled.some((s) => s.status === "running") &&
          Date.now() < deadline &&
          !signal.aborted
        ) {
          await sleep(
            Math.min(pollMs, Math.max(deadline - Date.now(), 0)),
            signal,
          );
          await lease();
          settled = await readAll(ops, unique);
          await heartbeat(settled);
        }
        const summary = summarize(settled);
        if (!signal.aborted) {
          await awaits.markCollected([
            ...summary.done.map((d) => d.id),
            ...summary.failed.map((f) => f.id),
          ]);
          if (summary.running.length > 0)
            await awaits.markAwaited(
              summary.running,
              new Date(Date.now() + AWAIT_AGAIN_GRACE_MS),
            );
        }
        return json(summary);
      }),
  );

  server.tool(
    "list_harnesses",
    "List the harnesses and images a sub-agent can run on, each with its harness name, effective size, and the provider it would run on, or why this agent cannot run it (relay that to the user). Use the harness name in spawn_subagent. If it is not obvious which fits, ask the user.",
    {},
    () => run(async () => json({ images: await ops.images() })),
  );

  server.tool(
    "list_connections",
    "List your own granted connections (id, name, hosts). A sub-agent can be given any of these by id in spawn_subagent's connections.",
    {},
    () => run(async () => json({ connections: await ops.connections() })),
  );

  server.tool(
    "get_budget",
    "Read your owner's compute: what is reserved now (cpu, memory) and the default worker size. Sub-agents past the free room queue and start as room frees, so a wide fan-out runs slower, not dead.",
    {},
    () => run(async () => json(await ops.budget())),
  );
}
