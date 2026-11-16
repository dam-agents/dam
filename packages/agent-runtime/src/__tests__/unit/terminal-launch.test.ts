/**
 * TEST_OVERVIEW: What a terminal Session's PTY runs. A Session the web
 * terminal opens as a shell runs the agent user's login shell, in place of the
 * image's terminal entrypoint, with the env of a terminal on the agent's
 * default harness and no model. It keeps being a shell when its PTY is started
 * again, a harness Session never becomes one, and the store names it Shell.
 */
import { describe, expect, it } from "vitest";
import {
  HARNESS_TERMINAL_ENTRYPOINT,
  loginShellOf,
  shellSessionMeta,
  startsShell,
  terminalEnvLease,
  terminalProgram,
} from "../../modules/terminal-launch.js";

const bash = () => "/bin/bash";

describe("startsShell", () => {
  /** TEST_SCENARIO: A new Session whose WebSocket asks for a shell starts one; a new Session that asks for nothing, or for a harness, starts the harness. */
  it("starts a shell for a new Session only when it is asked for", () => {
    expect(startsShell(undefined, { shell: true })).toBe(true);
    expect(startsShell({}, { shell: true })).toBe(true);
    expect(startsShell(undefined, {})).toBe(false);
  });

  /** TEST_SCENARIO: A shell Session whose PTY was reaped is opened again from the list, with no lease on the WebSocket, and starts a shell again rather than the default harness. */
  it("starts a shell Session's next PTY as a shell", () => {
    expect(startsShell({ shell: true }, {})).toBe(true);
  });

  /** TEST_SCENARIO: A harness Session keeps its harness even when a connection asks for a shell, so a harness conversation never turns into a shell. */
  it("keeps a harness Session on its harness", () => {
    expect(startsShell({ harness: "claude-code" }, { shell: true })).toBe(
      false,
    );
  });
});

describe("terminalProgram", () => {
  /** TEST_SCENARIO: A shell runs the agent user's shell with `-l`, so it reads the login profile, and not the harness entrypoint. */
  it("runs a login shell for a shell", () => {
    expect(terminalProgram({ kind: "shell" }, bash)).toEqual({
      file: "/bin/bash",
      args: ["-l"],
    });
  });

  /** TEST_SCENARIO: A harness terminal runs the image's terminal entrypoint and never asks for the login shell. */
  it("runs the terminal entrypoint for a harness", () => {
    const never = () => {
      throw new Error("a harness terminal reads no login shell");
    };
    expect(
      terminalProgram(
        { kind: "harness", harness: "codex", model: null },
        never,
      ),
    ).toEqual({ file: HARNESS_TERMINAL_ENTRYPOINT, args: [] });
  });
});

describe("terminalEnvLease", () => {
  /** TEST_SCENARIO: A shell asks for no harness and no model, so its env is that of a terminal on the agent's default harness with no model; a harness terminal keeps its own harness and model. */
  it("gives a shell the default harness's env with no model", () => {
    expect(terminalEnvLease({ kind: "shell" }, "claude-code")).toEqual({
      harness: "claude-code",
      model: null,
    });
    expect(
      terminalEnvLease(
        { kind: "harness", harness: "codex", model: "openai/gpt-5" },
        "claude-code",
      ),
    ).toEqual({ harness: "codex", model: "openai/gpt-5" });
  });
});

describe("shellSessionMeta", () => {
  /** TEST_SCENARIO: No harness lists a shell Session, so the store gives it the title Shell; a title it already has is kept. */
  it("marks the Session as a shell and names it Shell", () => {
    expect(shellSessionMeta(undefined)).toEqual({
      mode: "terminal",
      shell: true,
      title: "Shell",
    });
    expect(shellSessionMeta({ mode: "terminal", title: "Logs" })).toEqual({
      mode: "terminal",
      shell: true,
      title: "Logs",
    });
  });
});

describe("loginShellOf", () => {
  /** TEST_SCENARIO: The passwd entry names the shell `dam ssh` gives the agent user, so it wins over `$SHELL`. */
  it("takes the passwd entry's shell first", () => {
    expect(loginShellOf(() => "/bin/zsh", { SHELL: "/bin/bash" })).toBe(
      "/bin/zsh",
    );
  });

  /** TEST_SCENARIO: A uid with no passwd entry makes the read throw, and an entry may name no shell; each falls back to `$SHELL`, then to `/bin/sh`. */
  it("falls back to $SHELL, then /bin/sh", () => {
    const missing = () => {
      throw new Error("ENOENT");
    };
    expect(loginShellOf(missing, { SHELL: "/bin/bash" })).toBe("/bin/bash");
    expect(loginShellOf(() => null, {})).toBe("/bin/sh");
    expect(loginShellOf(() => "", { SHELL: "bash" })).toBe("/bin/sh");
  });
});
