import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { match } from "ts-pattern";
import { z } from "zod";
import {
  platformSubagentChoice,
  type SessionSubAgentContext,
} from "agent-runtime-api";
import {
  childEgressRuleSchema,
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
import { parseIdleTimeout } from "../../modules/environments/index.js";
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

const spawnDescription = (
  kept: boolean,
): string => `Spawn a platform sub-agent: a separate agent in its own new sandbox. This is not your harness's own subagent: if your harness has one, it runs here, starts in seconds and costs no extra compute, so prefer it whenever it can do the job. A platform sub-agent takes tens of seconds to minutes to start and its compute counts against the budget, so spawn one only when the task needs something only a separate sandbox gives, and name it in needs:
- different-harness: it must run on another harness (see list_harnesses);
- own-setup: it needs its own repository (seed), install command, env or skills;
- more-resources: more disk than this sandbox;
- isolation: the work must not be able to touch this workspace;
- parallel: heavy parallel work beyond what this sandbox can run;
- checked-result: a result the platform validates against a schema.
A need the request does not bear out is refused: different-harness on your own harness, own-setup without seed, install, env or skills, more-resources without resources.

When the work is a command whose output you need (a test suite, an eval, a benchmark, a build, a data transform), pass script instead of prompt. No model runs: the sub-agent runs the command once and you get its exit code and its exact stdout and stderr. A non-zero exit fails the sub-agent with the exit code and the tail of stderr. Write a prompt only when the work needs judgment. Pass prompt (with schema) or script, never both; a script takes no schema, model, mode or configOptions.

With a prompt, the sub-agent runs it to completion unattended, reports one result matching the JSON Schema you give, and is then removed. It cannot ask you anything, so the prompt must let it finish on its own. It runs on one of your model providers that its harness runs on (list_harnesses shows which, or what is missing); it holds your connections unless you pass connections. The user may set this session's platform sub-agents to a harness, model, mode or config option: those then bind, and the result names them. A setup step that fails fails the sub-agent at once with the reason.${kept ? KEPT_SPAWN_SENTENCES : ""} Returns the sub-agent id at once; call await_subagents with it to get the result. Do not retry this call blindly after an error: a duplicate call is a second sub-agent.`;

const KEPT_SPAWN_SENTENCES =
  " With neither prompt nor script it boots a clean slate that runs nothing: enter it with ssh sub-<id>, copy files in and out with scp, then start work with run_subagent. With keep it outlives its result, asleep, so you can enter it or run in it again (run_subagent), several runs at once too; without, it is removed after its result.";

const KEPT_AWAIT_SENTENCE =
  " Pass a sub-agent id for its latest run, or a run id from run_subagent for that run; a kept sub-agent's result also names its run and the session it ran in, which run_subagent can continue.";

const awaitDescription = (kept: boolean): string =>
  `Wait for sub-agents you started with spawn_subagent. Returns as soon as any of them finishes, or after about four minutes, listing which are done (with their result; for a script, its exit code and the start and end of its stdout and stderr), which failed (with the reason), and which are still running. Under waitingToStart, a running sub-agent that has not started yet says why: it waits for room in the memory your user's agents share, and starts on its own once room frees, with its whole time limit still ahead of it. Call it again with the still-running ids to keep waiting, or end your turn: a sub-agent that finishes while nothing waits on it is delivered to you as a new turn.${kept ? KEPT_AWAIT_SENTENCE : ""} An id that is not one of your sub-agents comes back under unknown. If the call itself fails with a connection or transport error, the sub-agents keep running: call it again with the same ids.`;

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
  const ack = `"\${PLATFORM_MCP_URL%/mcp}/invocations/${encodeURIComponent(input.id)}/output/${input.stream}/ack"`;
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
    "Harness to run on, as named by list_harnesses (e.g. claude-code). Pass this or image; with neither, the harness the user set for this session's platform sub-agents, else your own.",
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
    'Your connections it holds: "none" (the default), only its model; "parent", all of yours, granted and revoked with your own for as long as it lives; or a list of connection ids of your own (see list_connections), copied once.',
  ),
  seed: spawnShape.seed.describe(
    'Repository cloned into the workspace before the prompt: url, optional ref or commit, into "work" (default) or "home".',
  ),
  install: spawnShape.install.describe(
    "Shell command run once in the workspace before the prompt; must finish within 15 minutes.",
  ),
  env: spawnShape.env.describe("Environment variables, as [{name, value}]."),
  resources: spawnShape.resources.describe(
    "Workspace disk for the sub-agent's machine, as {storage}. Its CPU and memory are its owner's pool, not a spawn's to choose; an omitted disk comes from the harness's template. Give a clone or build more disk.",
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
      "Harness mode, as the Config panel names it. Leave unset unless you know the harness: a mode that asks for approvals stalls an unattended sub-agent. claude-code on Haiku 4.5 needs bypassPermissions, or its report_result waits for an approval until the deadline.",
    ),
  configOptions: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Harness config options as {name: value}: effort on claude-code (low to xhigh; Haiku 4.5 takes none) and codex (minimal to xhigh), approvals on bob. A setting the harness cannot apply fails the sub-agent as soon as it boots.",
    ),
};

const idleTimeoutShape = z
  .string()
  .optional()
  .describe(
    'How long it may sit idle before its machine sleeps, as minutes, hours or days ("15m", "2h"); the install\'s default otherwise. It wakes again for a run or ssh sub-<id>. A kept sub-agent always sleeps when idle.',
  );

// UNIT_BOUNDARY_DESCRIPTION: the spawn options that keep a sub-agent or give it egress of its own, offered only to an owner with the Environments feature, which kept sub-agents are part of.
const keptSpawnInput = {
  egress: spawnShape.egress.describe(
    'Whose egress rules decide its requests: "parent" (the default), yours, live; "open" or {"open": [rules]}, rules of its own that you set (update_subagent_egress), with no prompt to the user and anything else denied, except that a wildcard host (* or *.example.com), and a host your own rules do not reach unless your owner lets your sub-agents and Environments have network access of their own, wait for your owner\'s approval; or {"scoped": [hosts] or "all"}, a copy of your rules for those hosts that only the user can widen.',
  ),
  keep: spawnShape.keep.describe(
    "Keep it after its result: it sleeps with its disk instead of being removed, so you can enter it again over ssh sub-<id> or run more work in it, until keepForMs (a day by default, at most as long as an Environment lives). Without keep it is removed once it reports.",
  ),
  keepForMs: spawnShape.keepForMs.describe(
    "With keep, how long it is kept after its result, in milliseconds.",
  ),
  idleTimeout: idleTimeoutShape,
};

// UNIT_BOUNDARY_DESCRIPTION: a kept sub-agent's idle timeout as an agent writes it, in an Environment's units; "never" and zero are refused, since a kept sub-agent always sleeps when idle.
function subAgentIdleTimeout(
  value: string | undefined,
): { minutes: number } | string | undefined {
  if (value === undefined) return undefined;
  let parsed;
  try {
    parsed = parseIdleTimeout(value);
  } catch (err) {
    return (err as Error).message.replace(/^idle_timeout/, "idleTimeout");
  }
  if (parsed === "never" || parsed === undefined)
    return "a kept sub-agent always sleeps when idle: pass minutes, hours or days, such as 15m";
  return { minutes: parsed };
}

const OWNER_EGRESS_NOTE =
  "a rule to a wildcard host (* or *.example.com), or to a host your own rules do not reach while your owner has not let your sub-agents and Environments have network access of their own, is your owner's to approve: it waits for their verdict (egress_proposal status with its id), and until then only your other rules apply";

const OWNER_BLOCK_NOTE =
  "your owner blocked these on the sub-agent, and a block is theirs alone: the rules allowing them were not set, and only the owner can lift the block";

const openEgressAllows = (egress: unknown): boolean =>
  typeof egress === "object" &&
  egress !== null &&
  "open" in egress &&
  Array.isArray(egress.open) &&
  egress.open.some(
    (rule) =>
      typeof rule === "object" &&
      rule !== null &&
      (rule as { verdict?: unknown }).verdict === "allow",
  );

const KEPT_SPAWN_KEYS = Object.keys(
  keptSpawnInput,
) as (keyof typeof keptSpawnInput)[];

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
  if (needs.includes("more-resources") && body.resources?.storage === undefined)
    return "more-resources without resources.storage";
  return null;
}

interface ScriptEnd {
  exitCode: number | null;
  streams: InvocationOutput;
}

interface RunOf {
  run?: string;
  session?: string;
}

type Settled =
  | ({
      id: string;
      status: "done";
      result: unknown;
      script?: ScriptEnd;
    } & RunOf)
  | ({
      id: string;
      status: "failed";
      reason: string | undefined;
      script?: ScriptEnd;
    } & RunOf)
  | ({ id: string; status: "running"; waiting?: string } & RunOf)
  | { id: string; status: "idle" }
  | { id: string; status: "unknown" };

const runIdsOf = (settled: Settled[], wanted: Settled["status"][]): string[] =>
  settled.flatMap((s) =>
    wanted.includes(s.status) && "run" in s && s.run ? [s.run] : [],
  );

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
      const runOf: RunOf = {
        ...(view.run && { run: view.run }),
        ...(view.session && { session: view.session }),
      };
      if (view.status === "done")
        return { id, status: "done", result: view.result, ...script, ...runOf };
      if (view.status === "failed")
        return {
          id,
          status: "failed",
          reason: view.errorReason,
          ...script,
          ...runOf,
        };
      if (view.status === "idle") return { id, status: "idle" };
      return {
        id,
        status: "running",
        ...(view.waiting && { waiting: view.waiting }),
        ...runOf,
      };
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

// UNIT_BOUNDARY_DESCRIPTION: a run's own id and session come back only when they differ from what the caller passed, so a one-off sub-agent's result reads as it always did.
function runFields(s: { id: string } & RunOf): RunOf {
  return {
    ...(s.run && s.run !== s.id && { run: s.run }),
    ...(s.session && { session: s.session }),
  };
}

async function summarize(ops: DriverOps, settled: Settled[], kept: boolean) {
  const runFieldsOf = (s: { id: string } & RunOf): RunOf =>
    kept ? runFields(s) : {};
  const ended = await Promise.all(
    settled.map(async (s) =>
      (s.status === "done" || s.status === "failed") && s.script
        ? { ...s, report: await scriptReport(ops, s.run ?? s.id, s.script) }
        : { ...s, report: undefined },
    ),
  );
  return {
    done: ended.flatMap((s) =>
      s.status === "done"
        ? [
            s.report
              ? { id: s.id, ...runFieldsOf(s), ...s.report }
              : { id: s.id, ...runFieldsOf(s), result: s.result },
          ]
        : [],
    ),
    failed: ended.flatMap((s) =>
      s.status === "failed"
        ? [
            {
              id: s.id,
              ...runFieldsOf(s),
              reason: s.reason ?? null,
              ...s.report,
            },
          ]
        : [],
    ),
    running: settled.flatMap((s) => (s.status === "running" ? [s.id] : [])),
    waitingToStart: settled.flatMap((s) =>
      s.status === "running" && s.waiting
        ? [{ id: s.id, reason: s.waiting }]
        : [],
    ),
    idle: settled.flatMap((s) => (s.status === "idle" ? [s.id] : [])),
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
 * set model, mode or config option outranks the spawn's. With no set
 * harness, a spawn naming neither harness nor image runs on the agent's own,
 * since models read the harness as optional and leave it out. Below them the
 * spawn's own choice, then, on the session's own harness, the session's
 * model and settings, then the harness defaults; with no model at all the
 * spawn route refuses the spawn. The session's settings
 * follow only its model: they may not hold for another one (Haiku takes no
 * effort). A spawn on an image alone keeps its own choices.
 */
export function resolveSubAgent(
  args: SpawnArgs,
  session: SessionSubAgentContext | null,
  ownHarness: string | null,
): ResolvedSubAgent {
  const set = session ? platformSubagentChoice(session.settings) : null;
  if (set?.harness && args.harness && args.harness !== set.harness)
    return {
      ok: false,
      message: `this session's platform sub-agent setting runs every sub-agent on ${set.harness}, not ${args.harness}. Spawn on ${set.harness}, or ask the user to change the setting`,
    };
  const harness =
    args.harness ??
    (args.image ? undefined : (set?.harness ?? ownHarness ?? undefined));
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
      return rest.schema !== undefined && rest.schema !== null
        ? "a schema goes with a prompt; pass a prompt, or neither for a clean slate"
        : null;
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
  "this call names no session (a terminal session's calls never do), so its platform sub-agent settings cannot apply. Pass a harness and a provider-qualified model (list_harnesses lists each harness's models).";

export function registerSubAgentTools(
  server: McpServer,
  deps: {
    ops: DriverOps;
    awaits: SubAgentAwaitMarks;
    spawningSession: () => Promise<string | null>;
    requestSignal?: AbortSignal;
    sessionContext?: () => Promise<SessionSubAgentContext | null>;
    // UNIT_BOUNDARY_DESCRIPTION: the owner has the Environments feature, which brings kept sub-agents, clean slates, their runs and sessions, and a child's own egress; without it those tools and options are not offered.
    kept?: boolean;
    sessionIdentified?: boolean;
    catalogModels?: (harness: string) => Promise<CatalogModelRef[] | null>;
    waitMs?: number;
    pollMs?: number;
  },
): void {
  const { ops, awaits, requestSignal } = deps;
  const waitMs = deps.waitMs ?? SUB_AGENT_WAIT_MS;
  const pollMs = deps.pollMs ?? POLL_MS;

  const kept = deps.kept ?? false;
  server.registerTool(
    "spawn_subagent",
    {
      description: spawnDescription(kept),
      inputSchema: z.looseObject(
        kept ? { ...spawnInput, ...keptSpawnInput } : spawnInput,
      ),
    },
    (input) =>
      run(async () => {
        const accepted = kept
          ? { ...spawnInput, ...keptSpawnInput }
          : spawnInput;
        const ignored = kept ? [] : KEPT_SPAWN_KEYS.filter((k) => k in input);
        const args = Object.fromEntries(
          Object.entries(input).filter(([key]) => key in accepted),
        ) as z.infer<z.ZodObject<typeof spawnInput>> &
          Partial<z.infer<z.ZodObject<typeof keptSpawnInput>>>;
        const { needs, script, idleTimeout, ...given } = args;
        const idle = subAgentIdleTimeout(idleTimeout);
        if (typeof idle === "string")
          return errorResult(`spawn_subagent refused: ${idle}`);
        const rest = {
          ...given,
          ...(idle !== undefined && { idleTimeoutMin: idle.minutes }),
        };
        const kindRefusal =
          !kept && script === undefined && rest.prompt === undefined
            ? "pass a prompt (with schema) for a model turn, or a script"
            : workKindRefusal(script, rest, needs);
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
        const unidentified =
          session === null && deps.sessionIdentified === false;
        const [ownHarness, driverSessionId] = await Promise.all([
          session?.harness ? Promise.resolve(session.harness) : ops.harness(),
          deps.spawningSession(),
        ]);
        const resolved = resolveSubAgent(rest, session, ownHarness);
        if (!resolved.ok)
          return errorResult(`spawn_subagent refused: ${resolved.message}`);
        const { ok: _ok, bound, modelFrom, ...choice } = resolved;
        const refusedParse = (issues: { message: string }[]) =>
          errorResult(
            unidentified &&
              rest.harness === undefined &&
              rest.image === undefined
              ? `spawn_subagent refused: ${UNIDENTIFIED_SESSION}`
              : `spawn_subagent refused: ${issues.map((i) => i.message).join("; ")}`,
          );
        const from = { origin: "tool" as const, driverSessionId };
        const refusedNeed = (unmet: string) =>
          errorResult(
            `spawn_subagent refused: ${unmet}. Do the work in this sandbox, with your harness's own subagent if it has one, or state a need the request bears out.`,
          );

        let outcome: SpawnOutcome;
        let tag: string | undefined;
        let boundNote: string[];
        if (script === undefined && rest.prompt === undefined) {
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
            script: "true",
          });
          if (!parsed.success) return refusedParse(parsed.error.issues);
          const { script: _placeholder, ...body } = parsed.data;
          const unmet = unmetNeed(needs, parsed.data, ownHarness);
          if (unmet) return refusedNeed(unmet);
          outcome = await ops.spawnIdle(body, from);
          tag = body.label ?? body.harness ?? body.image;
          boundNote = bound.filter((b) => b.startsWith("harness "));
        } else if (script !== undefined) {
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
            if (refusal)
              return errorResult(`spawn_subagent refused: ${refusal}`);
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
            ...(openEgressAllows(args.egress)
              ? [`egress: ${OWNER_EGRESS_NOTE}`]
              : []),
            ...(ignored.length > 0
              ? [
                  `ignored ${ignored.join(", ")}: kept sub-agents are not available to this agent, so this one is removed after its result`,
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
    awaitDescription(kept),
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
        const lease = (settled: Settled[]) =>
          awaits.markAwaited(
            runIdsOf(settled, ["running"]),
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
          const running = settled.filter((s) => s.status === "running");
          const waiting = running.filter((s) => s.waiting).length;
          await extra
            .sendNotification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: beats,
                message: `Still waiting: ${running.length} running${waiting > 0 ? `, ${waiting} of them waiting for room to start` : ""}`,
              },
            })
            .catch(() => {});
        };
        let settled = await readAll(ops, unique);
        await awaits.markAwaited(
          runIdsOf(settled, ["running", "done", "failed"]),
          new Date(Date.now() + pollMs * LEASE_POLLS),
        );
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
          await lease(settled);
          settled = await readAll(ops, unique);
          await heartbeat(settled);
        }
        const summary = await summarize(ops, settled, kept);
        if (!signal.aborted) {
          await awaits.markCollected(runIdsOf(settled, ["done", "failed"]));
          const running = runIdsOf(settled, ["running"]);
          if (running.length > 0)
            await awaits.markAwaited(
              running,
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
        .describe(
          "A script sub-agent's id, from spawn_subagent, for its latest run; or a run id from run_subagent.",
        ),
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
    "List the harnesses and images a sub-agent can run on, each with its harness name and the provider a spawn naming no model runs on there, or why this agent cannot run it (relay that to the user). Use the harness name in spawn_subagent. If it is not obvious which fits, ask the user.",
    {},
    () => run(async () => json({ images: await ops.images() })),
  );

  if (kept) registerKeptTools(server, deps);

  server.tool(
    "list_connections",
    "List your own granted connections (id, name, hosts). A sub-agent can be given any of these by id in spawn_subagent's connections.",
    {},
    () => run(async () => json({ connections: await ops.connections() })),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the tools that work in a sub-agent after its spawn: start a run in a clean slate or a kept one, wake it, keep it longer, set an open one's egress rules.
function registerKeptTools(
  server: McpServer,
  deps: {
    ops: DriverOps;
    spawningSession: () => Promise<string | null>;
  },
): void {
  const { ops } = deps;
  server.tool(
    "run_subagent",
    'Start a run in a sub-agent you spawned with no task (a clean slate), or one you spawned with keep: a prompt (with schema) for a model turn, or a script, in the same machine with the files you put there (ssh sub-<id>, scp). A kept sub-agent takes several runs at once, as you run several sessions. A prompt continues the conversation of its latest prompt run by default, so it remembers that work; pass session "new" for a fresh conversation beside it, or the session an earlier result named to continue that one. A session takes one run at a time. Returns the run id; get the result with await_subagents and that run id. Without keep, the sub-agent is removed after this run\'s result.',
    {
      id: z.string().min(1).describe("The sub-agent's id."),
      prompt: z
        .string()
        .min(1)
        .optional()
        .describe(
          "The task for a model turn. Pass this with schema, or script.",
        ),
      schema: z
        .unknown()
        .optional()
        .describe("With prompt: the JSON Schema the result must match."),
      script: z
        .string()
        .min(1)
        .optional()
        .describe("A shell command to run instead of a prompt."),
      model: z
        .string()
        .min(1)
        .optional()
        .describe(
          "With prompt: the provider-qualified model, as list_harnesses names it; your default model on the sub-agent's harness otherwise.",
        ),
      session: z
        .string()
        .min(1)
        .optional()
        .describe(
          'With prompt: which conversation the run continues. Left out, that of the sub-agent\'s latest prompt run; "new" for a fresh one; or a session id from an earlier await_subagents result.',
        ),
      ttlMs: spawnShape.ttlMs.describe(
        "This run's time limit, in milliseconds; the spawn's by default.",
      ),
    },
    ({ id, prompt, schema, script, model, session, ttlMs }) =>
      run(async () => {
        if ((prompt === undefined) === (script === undefined))
          return errorResult(
            "run_subagent refused: pass a prompt (with schema) or a script",
          );
        if (prompt !== undefined && (schema === undefined || schema === null))
          return errorResult(
            "run_subagent refused: a prompt needs a schema: the JSON Schema its result must match",
          );
        if (script !== undefined && session !== undefined)
          return errorResult(
            "run_subagent refused: a script runs in no session; drop session",
          );
        const outcome = await ops.runSubagent(
          id,
          prompt !== undefined
            ? {
                prompt,
                schema: schemaFromText(schema),
                ...(model ? { model } : {}),
                ...(session ? { session } : {}),
              }
            : { script: script! },
          {
            ...(ttlMs !== undefined ? { ttlMs } : {}),
            origin: "tool",
            driverSessionId: await deps.spawningSession(),
          },
        );
        return outcome.ok
          ? textResult(
              [
                `[invoke] run ${outcome.run} started in ${id}`,
                JSON.stringify({
                  id,
                  run: outcome.run,
                  ...(outcome.session && { continues: outcome.session }),
                  running: true,
                  next: `Call await_subagents with ["${outcome.run}"] to get its result.`,
                }),
              ].join("\n"),
            )
          : errorResult(`run_subagent refused: ${outcome.message}`);
      }),
  );

  server.tool(
    "wake_subagent",
    "Wake a sleeping sub-agent of yours so you can enter it over SSH. `ssh sub-<id>` does this itself; this is for a script that waits on it some other way.",
    { id: z.string().min(1).describe("The sub-agent's id.") },
    ({ id }) =>
      run(async () => {
        const outcome = await ops.wakeSubagent(id);
        return outcome.ok
          ? json({ id, waking: true })
          : errorResult(`wake_subagent refused: ${outcome.message}`);
      }),
  );

  server.tool(
    "update_subagent",
    "Change a sub-agent you spawned with keep: keep it for longer, or shorter (keepForMs from now, at most as long as an Environment lives), or set how long it may sit idle before it sleeps (idleTimeout). Its Environments go with it when it is removed.",
    {
      id: z.string().min(1).describe("The sub-agent's id."),
      keepForMs: z
        .number()
        .int()
        .min(60_000)
        .optional()
        .describe("How long to keep it from now, in milliseconds."),
      idleTimeout: idleTimeoutShape,
    },
    ({ id, keepForMs, idleTimeout }) =>
      run(async () => {
        if (keepForMs === undefined && idleTimeout === undefined)
          return errorResult(
            "update_subagent refused: pass keepForMs, idleTimeout or both",
          );
        const idle = subAgentIdleTimeout(idleTimeout);
        if (typeof idle === "string")
          return errorResult(`update_subagent refused: ${idle}`);
        const outcome = await ops.extendKeep(id, {
          ...(keepForMs !== undefined && { keepForMs }),
          ...(idle !== undefined && { idleTimeoutMin: idle.minutes }),
        });
        return outcome.ok
          ? json({
              id,
              keepUntil: outcome.keepUntil,
              ...(outcome.idleTimeoutMin !== undefined && {
                idleTimeout: `${outcome.idleTimeoutMin}m`,
              }),
            })
          : errorResult(`update_subagent refused: ${outcome.message}`);
      }),
  );

  server.tool(
    "update_subagent_egress",
    'Replace the egress rules of a sub-agent or Environment you launched with egress "open": its requests are decided by these rules alone, with no prompt to the user, and a host outside them is denied. Each rule is {host, verdict: "allow" or "deny", port?, method?, pathPattern?}; host may be a *.wildcard or *. A rule allowing a wildcard host (* or *.example.com) is not yours to set, nor one allowing a host your own rules do not reach unless your owner lets your sub-agents and Environments have network access of their own: each waits for your owner\'s approval, and the answer names it. A rule allowing what your owner blocked on it is not set, and the answer names that too. Refused for one that follows your egress or has scoped egress, which only the user widens.',
    {
      id: z
        .string()
        .min(1)
        .describe(
          "The child's id, as spawn_subagent or create_environment returned it.",
        ),
      rules: z
        .array(childEgressRuleSchema)
        .max(200)
        .describe("The rules it may reach by, replacing those you set before."),
    },
    ({ id, rules }) =>
      run(async () => {
        const outcome = await ops.setChildEgress(id, rules);
        return outcome.ok
          ? json({
              id,
              rules: rules.length,
              ...(outcome.waiting.length > 0 && {
                waitingForOwner: outcome.waiting,
                note: OWNER_EGRESS_NOTE,
              }),
              ...(outcome.blocked.length > 0 && {
                blockedByOwner: outcome.blocked,
                blockedNote: OWNER_BLOCK_NOTE,
              }),
            })
          : errorResult(`update_subagent_egress refused: ${outcome.message}`);
      }),
  );
}
