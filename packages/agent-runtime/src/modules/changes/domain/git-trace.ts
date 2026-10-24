/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform's own variable naming the Session a
 * shell command runs in, set on a terminal Session's whole process tree. It
 * comes before every harness's own: a harness's runtime manifest names the
 * variable it sets on the shell commands of its chat Sessions
 * (`sessionEnvVar`), and those follow in the order the manifests list them.
 * Every one holds the id agent-runtime knows the Session by.
 */
export const PLATFORM_SESSION_ENV_VAR = "HARNESS_SESSION_ID";

export function sessionEnvVarsOf(
  harnessVars: readonly (string | undefined)[],
): string[] {
  return [
    ...new Set([
      PLATFORM_SESSION_ENV_VAR,
      ...harnessVars.filter((name) => name !== undefined),
    ]),
  ];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the git commands that record work on a branch.
 * A command that only reads, such as status or log, links nothing, and
 * neither does checkout: switching to a branch is not working on it.
 */
export const RECORDING_COMMANDS = new Set([
  "commit",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "am",
  "pull",
  "push",
]);

export interface GitCommand {
  name: string;
  worktree: string;
  sessionId: string | null;
  push: boolean;
}

interface TraceEvent {
  event?: unknown;
  sid?: unknown;
  name?: unknown;
  worktree?: unknown;
  param?: unknown;
  value?: unknown;
  code?: unknown;
}

const isString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads one git process's trace, a line of JSON
 * per event, and keeps only what links a Session: the command's name, the
 * worktree it ran in, the Session variable and whether it succeeded. The
 * trace also carries the full command line, which can hold a commit message
 * or a credential passed on it; that is never read, so it never leaves this
 * function. A child git process a command starts (a hook, maintenance) has a
 * trace of its own and is judged on its own. A command with no Session
 * variable is still returned: its Session is decided by agent-runtime.
 */
export function gitCommandOf(
  trace: string,
  sessionEnvVars: readonly string[],
): GitCommand | null {
  let name: string | null = null;
  let worktree: string | null = null;
  let exitCode: number | null = null;
  let topLevel: string | null = null;
  const params = new Map<string, string>();
  for (const line of trace.split("\n")) {
    if (line.trim() === "") continue;
    let event: TraceEvent;
    try {
      event = JSON.parse(line) as TraceEvent;
    } catch {
      continue;
    }
    if (!isString(event.sid)) continue;
    topLevel ??= event.sid;
    if (event.sid !== topLevel) continue;
    if (event.event === "cmd_name" && isString(event.name)) name = event.name;
    else if (event.event === "def_repo" && isString(event.worktree))
      worktree ??= event.worktree;
    else if (
      event.event === "def_param" &&
      isString(event.param) &&
      isString(event.value)
    )
      params.set(event.param, event.value);
    else if (event.event === "exit" && typeof event.code === "number")
      exitCode = event.code;
  }
  if (name === null || worktree === null || exitCode !== 0) return null;
  if (!RECORDING_COMMANDS.has(name)) return null;
  const sessionId =
    sessionEnvVars
      .map((key) => params.get(key))
      .find((value) => value !== undefined) ?? null;
  return { name, worktree, sessionId, push: name === "push" };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the git configuration that makes every git
 * process in the machine write its trace for agent-runtime: one file per process
 * in a directory the runtime owns, with only the Session variables named.
 * A directory, unlike a socket, never blocks git: a socket whose reader
 * stalls makes every git command wait, while a runtime that is down or slow
 * only leaves files behind, and a directory at its file cap makes git skip
 * the trace rather than wait.
 */
export function gitTraceEnv(
  dir: string,
  sessionEnvVars: readonly string[],
): Record<string, string> {
  return {
    GIT_TRACE2_EVENT: dir.endsWith("/") ? dir : `${dir}/`,
    GIT_TRACE2_EVENT_NESTING: "1",
    GIT_TRACE2_BRIEF: "1",
    GIT_TRACE2_ENV_VARS: sessionEnvVars.join(","),
    GIT_TRACE2_MAX_FILES: String(GIT_TRACE_MAX_FILES),
  };
}

export const GIT_TRACE_MAX_FILES = 2_000;
