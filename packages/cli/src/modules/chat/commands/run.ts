import { readFileSync } from "node:fs";
import { Command } from "commander";

import { err, ok, type Result } from "../../../result.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUN_STOPPED,
  EXIT_RUN_TIMEOUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";
import { parseTimeout } from "../../shared/parse-timeout.js";
import {
  DEFAULT_RUN_TIMEOUT_SECONDS,
  type RunError,
  type RunService,
} from "../services/run-service.js";
import { exitCodeFor, printError } from "./chat.js";

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
      `could not read prompt file '${opts.promptFile}': ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function readPromptFile(path: string): string {
  return readFileSync(path === "-" ? 0 : path, "utf8");
}

function fail(e: RunError): never {
  if (e.kind === "run-failed") {
    process.stderr.write(`error: ${e.reason}\n`);
    if (e.sessionId !== undefined)
      process.stderr.write(`session: ${e.sessionId}\n`);
    process.exit(EXIT_RUNTIME_FAILURE);
  }
  printError(e);
  process.exit(exitCodeFor(e));
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
    .argument("<agent>", "agent name or ID")
    .option("--server <url>", "override the configured server URL")
    .option("-p, --prompt <text>", "the prompt text")
    .option("--prompt-file <path>", "read the prompt from a file ('-' = stdin)")
    .option("--session <id>", "continue an existing session")
    .option("--async", "exit once the prompt has started; poll with 'run get'")
    .option(
      "--timeout <seconds>",
      `give up waiting after this many seconds (default ${String(DEFAULT_RUN_TIMEOUT_SECONDS)})`,
    )
    .action(
      async (
        agentRef: string,
        opts: {
          server?: string;
          prompt?: string;
          promptFile?: string;
          session?: string;
          async?: boolean;
          timeout?: string;
        },
      ) => {
        const prompt = resolvePrompt({
          prompt: opts.prompt,
          promptFile: opts.promptFile,
          readFile: readPromptFile,
        });
        if (!prompt.ok) {
          process.stderr.write(`error: ${prompt.error}\n`);
          process.exit(EXIT_INVALID_INPUT);
        }

        const result = await deps.runService.run({
          agentRef,
          serverFlag: opts.server,
          prompt: prompt.value,
          sessionId: opts.session,
          async: opts.async,
          timeoutSeconds: timeoutOrInvalid(opts.timeout),
        });
        if (!result.ok) fail(result.error);

        const outcome = result.value;
        if (outcome.kind === "async-started") {
          process.stdout.write(`${outcome.sessionId}\n`);
          process.stderr.write(
            `run started; poll it with: dam run get ${agentRef} ${outcome.sessionId}\n`,
          );
          return;
        }
        if (outcome.kind === "timed-out") {
          process.stderr.write(
            `timed out waiting; the run continues on the agent\n` +
              `check it with: dam run get ${agentRef} ${outcome.sessionId}\n`,
          );
          process.exit(EXIT_RUN_TIMEOUT);
        }
        endStdoutLine();
        process.stderr.write(
          `stopReason: ${outcome.stopReason ?? "unknown"}\n`,
        );
        process.exit(stopExitCode(outcome.stopReason));
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
    .action(
      async (
        agentRef: string,
        sessionId: string,
        opts: { server?: string; wait?: boolean; timeout?: string },
      ) => {
        const result = await deps.runService.get({
          agentRef,
          serverFlag: opts.server,
          sessionId,
          wait: opts.wait,
          timeoutSeconds: timeoutOrInvalid(opts.timeout),
        });
        if (!result.ok) fail(result.error);

        const outcome = result.value;
        if (outcome.kind === "pending") {
          process.stderr.write("still running\n");
          return;
        }
        if (outcome.kind === "none") {
          process.stderr.write(
            "no recorded result for this session — it never finished a headless run here, or the record was evicted\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        if (outcome.kind === "timed-out") {
          process.stderr.write("timed out waiting; the run continues\n");
          process.exit(EXIT_RUN_TIMEOUT);
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
        process.exit(stopExitCode(outcome.result.stopReason));
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
        if (!result.ok) fail(result.error);
        if (result.value.kind === "not-running") {
          process.stderr.write(
            "nothing to cancel: the session is not running\n",
          );
          process.exit(EXIT_INVALID_INPUT);
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

function endStdoutLine(): void {
  if (!stdoutEndedWithNewline) process.stdout.write("\n");
}
