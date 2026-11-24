import { match } from "ts-pattern";
import type { PlatformSessionMeta } from "./acp/infrastructure/session-metadata-store.js";

export const HARNESS_TERMINAL_ENTRYPOINT = "/usr/local/bin/harness-terminal";
export const SHELL_SESSION_TITLE = "Shell";
const LAST_RESORT_SHELL = "/bin/sh";

export interface TerminalRequest {
  harness?: string;
  model?: string;
  shell?: boolean;
}

export type TerminalLaunch =
  | { kind: "shell" }
  | { kind: "harness"; harness: string; model: string | null };

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a terminal Session runs the agent user's
 * login shell instead of a harness. A Session keeps what it started as: one
 * that started a shell starts a shell again when its PTY is gone, and one that
 * started a harness never turns into a shell. Only a Session with neither
 * takes what its WebSocket asks for.
 */
export function startsShell(
  meta: Pick<PlatformSessionMeta, "shell" | "harness"> | undefined,
  requested: Pick<TerminalRequest, "shell">,
): boolean {
  if (meta?.shell === true) return true;
  if (meta?.harness !== undefined) return false;
  return requested.shell === true;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the session-metadata store keeps for a shell
 * Session: the terminal mode, the shell mark that the next PTY reads, and a
 * title, since no harness lists the Session and so none can name it. A title
 * the Session already has stays.
 */
export function shellSessionMeta(
  meta: PlatformSessionMeta | undefined,
): PlatformSessionMeta {
  return {
    ...meta,
    mode: "terminal",
    shell: true,
    title: meta?.title ?? SHELL_SESSION_TITLE,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness whose env a terminal PTY gets. A
 * shell gets the env of a terminal on the agent's default harness with no
 * model, so a harness or a script started from the shell reaches the Model
 * Router and the credential gateway as it would from that terminal.
 */
export function terminalEnvLease(
  launch: TerminalLaunch,
  defaultHarness: string,
): { harness: string; model: string | null } {
  return match(launch)
    .with({ kind: "shell" }, () => ({ harness: defaultHarness, model: null }))
    .with({ kind: "harness" }, ({ harness, model }) => ({ harness, model }))
    .exhaustive();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the program a terminal PTY runs: the image's
 * terminal entrypoint for a harness, and for a shell the agent user's shell
 * started as a login shell, so it reads the same profile as an SSH login.
 */
export function terminalProgram(
  launch: TerminalLaunch,
  loginShell: () => string,
): { file: string; args: string[] } {
  return match(launch)
    .with({ kind: "shell" }, () => ({ file: loginShell(), args: ["-l"] }))
    .with({ kind: "harness" }, () => ({
      file: HARNESS_TERMINAL_ENTRYPOINT,
      args: [],
    }))
    .exhaustive();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the agent user's login shell: the one its passwd
 * entry names, which is the shell `dam ssh` gives the same user, else
 * `$SHELL`, else `/bin/sh`. A uid with no passwd entry makes the read throw,
 * which counts as no entry.
 */
export function loginShellOf(
  passwdShell: () => string | null,
  env: Readonly<Record<string, string | undefined>>,
): string {
  let shell: string | null = null;
  try {
    shell = passwdShell();
  } catch {
    shell = null;
  }
  return [shell, env.SHELL].find(isAbsolute) ?? LAST_RESORT_SHELL;
}

const isAbsolute = (path: string | null | undefined): path is string =>
  typeof path === "string" && path.startsWith("/");
