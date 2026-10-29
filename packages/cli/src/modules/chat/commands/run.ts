import { readFileSync } from "node:fs";
import { Command } from "commander";

import { err, ok, type Result } from "../../../result.js";
import {
  EXIT_AGENT_NOT_REACHABLE,
  EXIT_INVALID_INPUT,
  EXIT_RUN_STOPPED,
  EXIT_RUN_TIMEOUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import { parseTimeout } from "../../shared/parse-timeout.js";
import {
  DEFAULT_RUN_TIMEOUT_SECONDS,
  type RunError,
  type RunOutcome,
  type RunService,
  type SessionChoices,
} from "../services/run-service.js";
import { exitCodeFor, printError } from "./chat.js";
import { errorMessage } from "../../shared/error-message.js";
import { parseSettingFlags } from "../../shared/setting-flags.js";

const END_TURN = "end_turn";

export function resolvePrompt(opts: {
  prompt?: string;
  promptFile?: string;
  readFile: (path: string) => string;
}): Result<string, string> {
  if (opts.prompt !== undefined && opts.promptFile !== undefined)
    return err("pass exactly one of --prompt and --prompt-file");
  if (opts.prompt !== undefined) return ok(opts.prompt);
  if (opts.promptFile === undefined)
    return err("a prompt is required: pass --prompt or --prompt-file");
  try {
    return ok(opts.readFile(opts.promptFile));
  } catch (e) {
    return err(
      `could not read prompt file '${opts.promptFile}': ${errorMessage(e)}`,
    );
  }
}

export function choicesOrInvalid(opts: {
  session?: string;
  harness?: string;
  model?: string;
  setting: readonly string[];
}): Result<SessionChoices | undefined, string> {
  let settings: Record<string, string> | undefined;
  try {
    settings = parseSettingFlags(opts.setting);
  } catch (e) {
    return err(errorMessage(e));
  }
  const choices: SessionChoices = {
    ...(opts.harness !== undefined && { harness: opts.harness }),
    ...(opts.model !== undefined && { model: opts.model }),
    ...(settings && { settings }),
  };
  if (Object.keys(choices).length === 0) return ok(undefined);
  if (opts.session !== undefined)
    return err(
      "--harness, --model and --setting choose for a new session; a session from --session keeps its own",
    );
  return ok(choices);
}

function fail(e: RunError): void {
  if (e.kind === "run-failed") {
    process.stderr.write(`error: ${e.reason}\n`);
    if (e.sessionId !== undefined)
      process.stderr.write(`session: ${e.sessionId}\n`);
    process.exitCode = EXIT_RUNTIME_FAILURE;
    return;
  }
  if (e.kind === "agent-unreachable") {
    process.stderr.write(
      e.why === null
        ? "error: could not connect to the agent\n"
        : `error: the agent could not start: ${e.why}\n`,
    );
    if (e.sessionId !== undefined)
      process.stderr.write(`session: ${e.sessionId}\n`);
    process.exitCode = EXIT_AGENT_NOT_REACHABLE;
    return;
  }
  printError(e);
  process.exitCode = exitCodeFor(e);
}

export function runJson(outcome: RunOutcome): Record<string, unknown> {
  if (outcome.kind === "completed")
    return {
      status: "done",
      sessionId: outcome.sessionId,
      stopReason: outcome.stopReason,
      text: outcome.text,
    };
  return { status: "pending", sessionId: outcome.sessionId };
}

function stopExitCode(stopReason: string | null): number {
  return stopReason === END_TURN ? 0 : EXIT_RUN_STOPPED;
}

function timeoutOrInvalid(raw: string | undefined): number {
  const seconds = parseTimeout(raw, DEFAULT_RUN_TIMEOUT_SECONDS);
  if (seconds === null) {
    process.stderr.write("error: --timeout must be a positive number\n");
    process.exit(EXIT_INVALID_INPUT);
  }
  return seconds;
}

export function buildRunCommand(deps: { runService: RunService }): Command {
  const run = new Command("run")
    .description(
      "Run an agent headlessly: submit a prompt and stream the answer",
    )
    .enablePositionalOptions()
    .argument("<agent>", "agent name or ID")
    .option("--server <url>", "override the configured server URL")
    .option("-p, --prompt <text>", "the prompt text")
    .option("--prompt-file <path>", "read the prompt from a file ('-' = stdin)")
    .option("--session <id>", "continue an existing session")
    .option(
      "--harness <name>",
      "harness a new session runs on, one the agent carries (default: the agent's default)",
    )
    .option(
      "--model <model>",
      "model a new session runs on, as <provider>/<model id> (default: the agent's default; see `dam agent models`)",
    )
    .option(
      "--setting <id=value>",
      "a per-session setting of the harness for a new session, e.g. effort=high (repeatable)",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option("--async", "exit once the prompt has started; poll with 'run get'")
    .option(
      "--timeout <seconds>",
      `give up waiting after this many seconds (default ${String(DEFAULT_RUN_TIMEOUT_SECONDS)})`,
    )
    .option(
      "--json",
      "print one JSON object at the end instead of streaming the answer",
    )
    .action(
      async (
        agentRef: string,
        opts: {
          server?: string;
          prompt?: string;
          promptFile?: string;
          session?: string;
          harness?: string;
          model?: string;
          setting: string[];
          async?: boolean;
          timeout?: string;
          json?: boolean;
        },
      ) => {
        const choices = choicesOrInvalid(opts);
        if (!choices.ok) {
          process.stderr.write(`error: ${choices.error}\n`);
          process.exitCode = EXIT_INVALID_INPUT;
          return;
        }
        const prompt = resolvePrompt({
          prompt: opts.prompt,
          promptFile: opts.promptFile,
          readFile: (path) => readFileSync(path === "-" ? 0 : path, "utf8"),
        });
        if (!prompt.ok) {
          process.stderr.write(`error: ${prompt.error}\n`);
          process.exitCode = EXIT_INVALID_INPUT;
          return;
        }

        const result = await deps.runService.run({
          agentRef,
          serverFlag: opts.server,
          prompt: prompt.value,
          sessionId: opts.session,
          ...(choices.value && { choices: choices.value }),
          async: opts.async,
          quiet: opts.json,
          timeoutSeconds: timeoutOrInvalid(opts.timeout),
        });
        if (!result.ok) {
          fail(result.error);
          return;
        }

        const outcome = result.value;
        if (opts.json)
          process.stdout.write(`${JSON.stringify(runJson(outcome))}\n`);
        if (outcome.kind === "async-started") {
          if (!opts.json) process.stdout.write(`${outcome.sessionId}\n`);
          process.stderr.write(
            `run started; poll it with: dam run get ${agentRef} ${outcome.sessionId}\n` +
              `session: ${outcome.sessionId}\n`,
          );
          return;
        }
        if (outcome.kind === "timed-out") {
          process.stderr.write(
            `timed out waiting; the run continues on the agent\n` +
              `check it with: dam run get ${agentRef} ${outcome.sessionId}\n` +
              `session: ${outcome.sessionId}\n`,
          );
          process.exitCode = EXIT_RUN_TIMEOUT;
          return;
        }
        if (!opts.json && !stdoutEndedWithNewline) process.stdout.write("\n");
        process.stderr.write(
          `stopReason: ${outcome.stopReason ?? "unknown"}\n` +
            `session: ${outcome.sessionId}\n`,
        );
        process.exitCode = stopExitCode(outcome.stopReason);
      },
    );

  run
    .command("get")
    .description("Read a headless run's recorded result")
    .argument("<agent>", "agent name or ID")
    .argument("<session-id>", "the run's session id")
    .option("--server <url>", "override the configured server URL")
    .option("-w, --wait", "wait for the running turn to finish")
    .option(
      "--timeout <seconds>",
      `with --wait, give up after this many seconds (default ${String(DEFAULT_RUN_TIMEOUT_SECONDS)})`,
    )
    .option("--json", "emit the raw run-result payload instead of plain text")
    .action(
      async (
        agentRef: string,
        sessionId: string,
        opts: {
          server?: string;
          wait?: boolean;
          timeout?: string;
          json?: boolean;
        },
      ) => {
        const result = await deps.runService.get({
          agentRef,
          serverFlag: opts.server,
          sessionId,
          wait: opts.wait,
          timeoutSeconds: timeoutOrInvalid(opts.timeout),
        });
        if (!result.ok) {
          fail(result.error);
          return;
        }

        const outcome = result.value;
        if (outcome.kind === "pending") {
          if (opts.json)
            process.stdout.write(`${JSON.stringify({ status: "pending" })}\n`);
          else process.stderr.write("still running\n");
          return;
        }
        if (outcome.kind === "none") {
          if (opts.json)
            process.stdout.write(`${JSON.stringify({ status: "none" })}\n`);
          else
            process.stderr.write(
              "no recorded result for this session — it never finished a headless run here, or the record was evicted\n",
            );
          process.exitCode = EXIT_INVALID_INPUT;
          return;
        }
        if (outcome.kind === "timed-out") {
          if (opts.json)
            process.stdout.write(`${JSON.stringify({ status: "pending" })}\n`);
          process.stderr.write("timed out waiting; the run continues\n");
          process.exitCode = EXIT_RUN_TIMEOUT;
          return;
        }
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ status: "done", result: outcome.result })}\n`,
          );
          process.exitCode = stopExitCode(outcome.result.stopReason);
          return;
        }
        if (outcome.result.finalText.length > 0) {
          process.stdout.write(outcome.result.finalText);
          if (!outcome.result.finalText.endsWith("\n"))
            process.stdout.write("\n");
        }
        if (outcome.result.truncated)
          process.stderr.write("note: the recorded run output was truncated\n");
        process.stderr.write(
          `stopReason: ${outcome.result.stopReason ?? "unknown"}\n`,
        );
        process.exitCode = stopExitCode(outcome.result.stopReason);
      },
    );

  run
    .command("cancel")
    .description("Cancel a running headless run")
    .argument("<agent>", "agent name or ID")
    .argument("<session-id>", "the run's session id")
    .option("--server <url>", "override the configured server URL")
    .action(
      async (
        agentRef: string,
        sessionId: string,
        opts: { server?: string },
      ) => {
        const result = await deps.runService.cancel({
          agentRef,
          serverFlag: opts.server,
          sessionId,
        });
        if (!result.ok) {
          fail(result.error);
          return;
        }
        if (result.value.kind === "not-running") {
          process.stderr.write(
            "nothing to cancel: the session is not running\n",
          );
          process.exitCode = EXIT_INVALID_INPUT;
          return;
        }
        process.stderr.write("cancel sent\n");
      },
    );

  return run;
}

let stdoutEndedWithNewline = true;

export function trackStdout(text: string): void {
  process.stdout.write(text);
  if (text.length > 0) stdoutEndedWithNewline = text.endsWith("\n");
}
