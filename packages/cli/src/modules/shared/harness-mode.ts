import { EXIT_RUNTIME_FAILURE } from "./exit-codes.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the mode a `dam` running inside one of the
 * install's assistants uses. The machine has no account of its own and no
 * credential; its own harness path is the proof of which Agent it is, so the CLI
 * talks to `<harness base>/api/agents/<id>/cli/trpc` with no Authorization
 * header and never reads a credential store.
 */
export const HARNESS_URL_ENV_VAR = "DAM_HARNESS_URL";
export const HARNESS_AGENT_ID_ENV_VAR = "DAM_AGENT_ID";

export interface HarnessMode {
  baseUrl: string;
  agentId: string;
}

export function readHarnessMode(
  env: NodeJS.ProcessEnv = process.env,
): HarnessMode | null {
  const baseUrl = env[HARNESS_URL_ENV_VAR];
  const agentId = env[HARNESS_AGENT_ID_ENV_VAR];
  if (!baseUrl || !agentId) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), agentId };
}

export function cliTrpcUrl(mode: HarnessMode): string {
  return `${mode.baseUrl}/api/agents/${encodeURIComponent(mode.agentId)}/cli/trpc`;
}

export function cliVersionUrl(mode: HarnessMode): string {
  return `${mode.baseUrl}/api/agents/${encodeURIComponent(mode.agentId)}/cli/version`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the verbs that need the owner's own doors — a chat
 * or terminal attach, a shell, a headless run, a workspace file, an import.
 * Inside an assistant those relays are not reachable and must not be: the
 * machine asks for changes through the platform API, it does not act as the
 * person. Saying so plainly beats a connection that fails somewhere deep.
 */
const HARNESS_UNAVAILABLE: Record<string, string> = {
  chat: "attach to an agent's terminal",
  session: "read an agent's sessions",
  run: "run an agent headlessly",
  ssh: "open a shell in an agent",
  import: "import files into an agent",
  file: "read or write an agent's files",
};

export function refuseInHarnessMode(
  verb: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (readHarnessMode(env) === null) return;
  const what = HARNESS_UNAVAILABLE[verb] ?? `run \`dam ${verb}\``;
  process.stderr.write(
    `error: \`dam ${verb}\` would ${what}, and that is not available from inside the assistant: it needs the owner's own sign-in, not the assistant's harness path.\n` +
      `hint: the rest of \`dam\` works here, and changes wait for the owner's approval on Home.\n`,
  );
  process.exit(EXIT_RUNTIME_FAILURE);
}

export function harnessUnavailableVerbs(): readonly string[] {
  return Object.keys(HARNESS_UNAVAILABLE);
}
