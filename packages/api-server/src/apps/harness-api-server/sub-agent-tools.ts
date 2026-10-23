import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { match } from "ts-pattern";
import { z } from "zod";
import {
  platformSubagentChoice,
  type SessionSubAgentContext,
} from "agent-runtime-api";
import {
  formatQualifiedModel,
  INVOCATION_OUTPUT_STREAMS,
  type InvocationOutput,
  invocationOutputStreamSchema,
  parseQualifiedModel,
  spawnInvocationRequestSchema,
  spawnScriptInvocationRequestSchema,
} from "api-server-api";
import {
  errorResult,
  json,
  run,
  textResult,
} from "../../core/mcp-tool-result.js";
import {
  NO_SPAWN_MODEL_MESSAGE,
  type SubAgentAwaitMarks,
} from "../../modules/invocations/index.js";
import type {
  DriverOps,
  ScriptSpawnRequest,
  SpawnOutcome,
} from "./driver-ops.js";

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

When the work is a command whose output you need (a test suite, an eval, a benchmark, a build, a data transform), pass script instead of prompt. No model runs: the sub-agent runs the command once and you get its exit code and its exact stdout and stderr. A non-zero exit fails the sub-agent with the exit code and the tail of stderr. Write a prompt only when the work needs judgment. Pass prompt (with schema) or script, never both; a script takes no schema, model, mode or configOptions.

With a prompt, the sub-agent runs it to completion unattended, reports one result matching the JSON Schema you give, and is then removed. It cannot ask you anything, so the prompt must let it finish on its own. It runs on one of your model providers that its harness runs on (list_harnesses shows which, or what is missing); connections you pass must be your own grants (see list_connections). The user may set this session's platform sub-agents to a harness, model, mode or config option: those then bind, and the result names them. A setup step that fails fails the sub-agent at once with the reason. Returns the sub-agent id at once; call await_subagents with it to get the result. Do not retry this call blindly after an error: a duplicate call is a second sub-agent.`;

const AWAIT_DESCRIPTION = `Wait for sub-agents you started with spawn_subagent. Returns as soon as any of them finishes, or after about four minutes, listing which are done (with their result; for a script, its exit code and the start and end of its stdout and stderr), which failed (with the reason), and which are still running. Call it again with the still-running ids to keep waiting, or end your turn: a sub-agent that finishes while nothing waits on it is delivered to you as a new turn. An id that is not one of your sub-agents comes back under unknown. If the call itself fails with a connection or transport error, the sub-agents keep running: call it again with the same ids.`;

const FETCH_DESCRIPTION = `Save the full stdout or stderr of a finished script sub-agent to a file in your sandbox, as await_subagents only shows its start and end. Returns one shell command: run it, and it downloads the stream byte for byte to the path you give and checks its sha256. Then read the file as often as you need. The platform deletes its copy once the download is checked, so fetch each stream once; one nobody fetches is deleted after seven days.`;

function noStream(id: string, stream: string): string {
  return `fetch_subagent_output: ${id} holds no ${stream}. It is not one of your script sub-agents, it has not finished, or the stream was already read or expired.`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one shell line that brings a stream into the
 * agent's sandbox byte for byte, so the bytes never pass through a tool
 * result. It downloads through the presigned link, checks the sha256 the
 * sub-agent reported, and only then acks, so a failed download keeps the
 * stream for another try. The ack goes to the driver's own route, found from
 * the PLATFORM_MCP_URL every agent has.
 */
function downloadCommand(input: {
  id: string;
  stream: string;
  path: string;
  url: string;
  sha256: string;
}): string {
  const ack = `"\${PLATFORM_MCP_URL%/mcp}/invocations/${input.id}/output/${input.stream}/ack"`;
  return [
    `curl -fsS -o '${input.path}' '${input.url}'`,
    `printf '%s  %s\\n' '${input.sha256}' '${input.path}' | sha256sum -c --quiet -`,
    `curl -fsS -X POST ${ack}`,
  ].join(" && ");
}

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
  prompt: spawnShape.prompt
    .optional()
    .describe(
      "The sub-agent's whole task, for a model. It sees only this, so include everything it needs. Pass this or script.",
    ),
  schema: spawnShape.schema
    .optional()
    .describe(
      'Required with prompt, left out with script: JSON Schema the result must match, e.g. {"type":"integer"} or {"type":"object","properties":{"pass":{"type":"boolean"}},"required":["pass"]}. The platform checks shape only, never truth.',
    ),
  script: z
    .string()
    .min(1)
    .optional()
    .describe(
      "A shell command run once with bash -lc in the sub-agent's workspace, after seed and install, with no model turn. You get its exit code, stdout and stderr. Pass this or prompt.",
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
      "Model the sub-agent runs, provider-qualified (ibm/gpt-5.5, claude/ibm/aws/claude-sonnet-5-5 on claude-code). Ignored when the user set a model for this session's platform sub-agents. It must be a model this agent's providers list for the target harness; the refusal names the listed ones. Unset, this session's model on your own harness; on another harness the spawn is refused, so pass one.",
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
  body: Omit<ScriptSpawnRequest, "script">,
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

interface ScriptEnd {
  exitCode: number | null;
  streams: InvocationOutput;
}

type Settled =
  | { id: string; status: "done"; result: unknown; script?: ScriptEnd }
  | {
      id: string;
      status: "failed";
      reason: string | undefined;
      script?: ScriptEnd;
    }
  | { id: string; status: "running" }
  | { id: string; status: "unknown" };

async function readAll(ops: DriverOps, ids: string[]): Promise<Settled[]> {
  return Promise.all(
    ids.map(async (id): Promise<Settled> => {
      const view = await ops.get(id);
      if (!view) return { id, status: "unknown" };
      const script =
        view.output !== undefined
          ? {
              script: { exitCode: view.exitCode ?? null, streams: view.output },
            }
          : {};
      if (view.status === "done")
        return { id, status: "done", result: view.result, ...script };
      if (view.status === "failed")
        return { id, status: "failed", reason: view.errorReason, ...script };
      return { id, status: "running" };
    }),
  );
}

const PREVIEW_EDGE_BYTES = 1_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what await_subagents tells about a finished
 * script: its exit code and, per stream, the size and the first and last
 * bytes. The whole output never goes into the model's context; the agent
 * reads a stream in full with fetch_subagent_output.
 */
async function scriptReport(
  ops: DriverOps,
  id: string,
  script: ScriptEnd,
): Promise<object> {
  const streams = await Promise.all(
    INVOCATION_OUTPUT_STREAMS.map(async (stream) => {
      if (!script.streams[stream]) return [stream, "already read or expired"];
      const preview = await ops.outputPreview(id, stream, PREVIEW_EDGE_BYTES);
      return [stream, preview ?? "already read or expired"];
    }),
  );
  return {
    exitCode: script.exitCode,
    ...Object.fromEntries(streams),
    read: "fetch_subagent_output saves a stream in full to a file",
  };
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

async function summarize(ops: DriverOps, settled: Settled[]) {
  const ended = await Promise.all(
    settled.map(async (s) =>
      (s.status === "done" || s.status === "failed") && s.script
        ? { ...s, report: await scriptReport(ops, s.id, s.script) }
        : { ...s, report: undefined },
    ),
  );
  return {
    done: ended.flatMap((s) =>
      s.status === "done"
        ? [
            s.report
              ? { id: s.id, ...s.report }
              : { id: s.id, result: s.result },
          ]
        : [],
    ),
    failed: ended.flatMap((s) =>
      s.status === "failed"
        ? [{ id: s.id, reason: s.reason ?? null, ...s.report }]
        : [],
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
 * model and settings, then the harness defaults; with no model at all the
 * spawn route refuses the spawn. The session's settings
 * follow only its model: they may not hold for another one (Haiku takes no
 * effort). A spawn on an image alone keeps its own choices.
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
  const sameModel = !bound?.model && args.model === undefined;
  const mode =
    bound?.mode ?? args.mode ?? (sameModel ? inherited.mode : undefined);
  const configOptions = {
    ...(sameModel && inherited.configOptions),
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
 * until its deadline. A harness the catalog has no view for is not checked,
 * and neither is a model of a provider that lists nothing for the harness:
 * the spawn's provider check then names the provider to attach or the one
 * to name instead, which a list of models cannot.
 */
function unlistedModel(
  model: string,
  listed: readonly CatalogModelRef[] | null,
): string | null {
  if (listed === null) return null;
  const wanted = parseQualifiedModel(model, { claudePrefix: true });
  if (wanted !== null && !listed.some((m) => m.alias === wanted.alias))
    return null;
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

const BOTH_KINDS =
  "pass either prompt (with schema) for a model turn, or script for a command, not both";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a spawn is either a prompt for a model or a
 * script with no model, never both, and the tool says which field to drop
 * instead of guessing: a call that names both is ambiguous about whether the
 * caller wants the command's output or a model's judgment of it.
 */
function workKindRefusal(
  script: string | undefined,
  rest: {
    prompt?: string | undefined;
    schema?: unknown;
    model?: string | undefined;
    mode?: string | undefined;
    configOptions?: Record<string, string> | undefined;
  },
  needs: readonly SpawnNeed[],
): string | null {
  if (script === undefined) {
    if (rest.prompt === undefined)
      return "pass a prompt (with schema) for a model turn, or a script for a command";
    return rest.schema === undefined || rest.schema === null
      ? "a prompt needs a schema: the JSON Schema its result must match"
      : null;
  }
  const extra = (
    ["prompt", "schema", "model", "mode", "configOptions"] as const
  ).filter((field) => rest[field] !== undefined && rest[field] !== null);
  if (extra.length > 0) return `${BOTH_KINDS}; drop ${extra.join(", ")}`;
  if (needs.includes("checked-result"))
    return "checked-result, but a script's output is not checked against a schema";
  return null;
}

const UNIDENTIFIED_SESSION =
  "this session does not identify itself to the platform (Bob sessions and terminal sessions do not), so its platform sub-agent settings cannot apply. Pass a harness and a provider-qualified model (list_harnesses lists each harness's models).";

export function registerSubAgentTools(
  server: McpServer,
  deps: {
    ops: DriverOps;
    awaits: SubAgentAwaitMarks;
    spawningSession: () => Promise<string | null>;
    requestSignal?: AbortSignal;
    sessionContext?: () => Promise<SessionSubAgentContext | null>;
    sessionIdentified?: boolean;
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
      const { needs, script, ...rest } = args;
      const kindRefusal = workKindRefusal(script, rest, needs);
      if (kindRefusal)
        return errorResult(`spawn_subagent refused: ${kindRefusal}`);
      let session: SessionSubAgentContext | null;
      try {
        session = (await deps.sessionContext?.()) ?? null;
      } catch (err) {
        if (!(err instanceof SessionSettingsUnreadableError)) throw err;
        return errorResult(
          "spawn_subagent refused: this session's settings could not be read, so its platform sub-agent settings cannot be applied. Try again.",
        );
      }
      const unidentified = session === null && deps.sessionIdentified === false;
      const resolved = resolveSubAgent(rest, session);
      if (!resolved.ok)
        return errorResult(`spawn_subagent refused: ${resolved.message}`);
      const { ok: _ok, bound, modelFrom, ...choice } = resolved;
      const refusedParse = (issues: { message: string }[]) =>
        errorResult(
          unidentified && rest.harness === undefined && rest.image === undefined
            ? `spawn_subagent refused: ${UNIDENTIFIED_SESSION}`
            : `spawn_subagent refused: ${issues.map((i) => i.message).join("; ")}`,
        );
      const [ownHarness, driverSessionId] = await Promise.all([
        session?.harness ? Promise.resolve(session.harness) : ops.harness(),
        deps.spawningSession(),
      ]);
      const from = { origin: "tool" as const, driverSessionId };
      const refusedNeed = (unmet: string) =>
        errorResult(
          `spawn_subagent refused: ${unmet}. Do the work in this sandbox, with your harness's own subagent if it has one, or state a need the request bears out.`,
        );

      let outcome: SpawnOutcome;
      let tag: string | undefined;
      let boundNote: string[];
      if (script !== undefined) {
        const {
          prompt: _prompt,
          schema: _schema,
          model: _model,
          mode: _mode,
          configOptions: _configOptions,
          ...target
        } = rest;
        const parsed = spawnScriptInvocationRequestSchema.safeParse({
          ...target,
          ...(choice.harness !== undefined && { harness: choice.harness }),
          script,
        });
        if (!parsed.success) return refusedParse(parsed.error.issues);
        const body = parsed.data;
        const unmet = unmetNeed(needs, body, ownHarness);
        if (unmet) return refusedNeed(unmet);
        outcome = await ops.spawnScript(body, from);
        tag = body.label ?? body.harness ?? body.image;
        boundNote = bound.filter((b) => b.startsWith("harness "));
      } else {
        const parsed = spawnInvocationRequestSchema.safeParse(
          withHarnessConfig({
            ...rest,
            ...choice,
            schema: schemaFromText(rest.schema),
          }),
        );
        if (!parsed.success) return refusedParse(parsed.error.issues);
        const body = parsed.data;
        const { catalogModels } = deps;
        const { model } = choice;
        const target = body.harness;
        if (model && target && catalogModels) {
          const listed = () => catalogModels(target);
          const refusal = await match(modelFrom)
            .with("session", undefined, () => null)
            .with("setting", async () => {
              const unlisted = unlistedModel(model, await listed());
              return unlisted
                ? `this session's platform sub-agent setting names ${model}, and ${unlisted}. Ask the user to change the setting.`
                : null;
            })
            .with("spawn", async () => unlistedModel(model, await listed()))
            .exhaustive();
          if (refusal) return errorResult(`spawn_subagent refused: ${refusal}`);
        }
        const unmet = unmetNeed(needs, body, ownHarness);
        if (unmet) return refusedNeed(unmet);
        outcome = await ops.spawn(body, from);
        tag = body.label ?? body.harness ?? body.image;
        boundNote = bound;
      }
      if (!outcome.ok) {
        return errorResult(
          unidentified && outcome.message === NO_SPAWN_MODEL_MESSAGE
            ? `spawn_subagent refused: nothing names the sub-agent's model, and ${UNIDENTIFIED_SESSION}`
            : `spawn_subagent refused: ${outcome.message}`,
        );
      }
      return textResult(
        [
          `[invoke] spawned ${tag ?? outcome.id} -> ${outcome.id}`,
          `needs: ${needs.join(", ")}`,
          ...(boundNote.length > 0
            ? [
                `set by this session's platform sub-agent settings: ${boundNote.join(", ")} (arguments for these are ignored)`,
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
        const summary = await summarize(ops, settled);
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
    "fetch_subagent_output",
    FETCH_DESCRIPTION,
    {
      id: z
        .string()
        .min(1)
        .describe("A script sub-agent's id, from spawn_subagent."),
      stream: invocationOutputStreamSchema.describe(
        "Which stream to read: stdout or stderr.",
      ),
      path: z
        .string()
        .min(1)
        .max(1024)
        .describe(
          "Where to save the stream in your sandbox. You get one shell command that downloads it there and checks it; run that command yourself, then read the file.",
        ),
    },
    ({ id, stream, path }) =>
      run(async () => {
        if (/['\n\r]/.test(path))
          return errorResult(
            "fetch_subagent_output refused: the path must not contain a quote or a line break",
          );
        const link = await ops.outputLink(id, stream);
        if (!link) return errorResult(noStream(id, stream));
        return textResult(
          [
            `Run this command to save the ${stream} of ${id} (${link.sizeBytes} bytes) to ${path}. It checks the sha256 and then tells the platform to delete its copy; the link works for 15 minutes.`,
            downloadCommand({ id, stream, path, ...link }),
          ].join("\n"),
        );
      }),
  );

  server.tool(
    "list_harnesses",
    "List the harnesses and images a sub-agent can run on, each with its harness name, effective size, and the provider a spawn naming no model runs on there, or why this agent cannot run it (relay that to the user). Use the harness name in spawn_subagent. If it is not obvious which fits, ask the user.",
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
