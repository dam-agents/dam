import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  invocationScriptEventPayload,
  type DriverBinding,
  type EventHandler,
  type InvocationScriptEventPayload,
  type Plugin,
} from "agent-runtime-api";
import {
  INVOCATION_OUTPUT_STREAMS,
  MAX_SCRIPT_OUTPUT_BYTES,
  SCRIPT_FAILURE_MAX_CHARS,
  type InvocationOutput,
  type ScriptReportInput,
} from "api-server-api";

import type { HarnessClient } from "../harness-client.js";
import { uploadFile } from "../infrastructure/blob-upload.js";
import { runScript, type ScriptRun } from "../infrastructure/script-run.js";
import { sentinelExists } from "./sentinel.js";

const IMPL_NAME = "invocation-script";

const STARTED_SENTINEL = "script.started";

const REPORT_ATTEMPTS = 5;

const REPORT_RETRY_DELAY_MS = 3_000;

type ScriptHarness = Pick<
  HarnessClient["invocations"]["v1"],
  "scriptUploads" | "reportScript"
>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: runs a script sub-agent's one command in place of
 * a model turn. Event handlers run one at a time inside a state apply, so the
 * handler only starts the run and settles; the run reports on its own once the
 * script ends. A sentinel per event keeps a redelivered event from running its
 * script a second time, while a later run in the same machine (a clean slate's
 * or a kept sub-agent's run, a new event) runs its own. Uploads and the report
 * name the event as the run, so they land on that run of a sub-agent that
 * runs several, each with its output in files of its own. Both streams are
 * uploaded whatever the exit code, so a driver can read a failed run's output
 * too. A run the platform ended is killed by its run id.
 */
export function createInvocationScriptPlugin(deps: {
  workDir: string;
  spawnEnv: () => NodeJS.ProcessEnv;
  harness: ScriptHarness;
  log: (msg: string) => void;
}): Plugin & { isBusy: () => boolean; stop: (run: string) => boolean } {
  let running = 0;
  const runs = new Map<string, AbortController>();

  async function upload(
    run: ScriptRun,
    reportBy: Date,
    runId: string,
  ): Promise<{ output: InvocationOutput; failure?: string }> {
    const output: InvocationOutput = {};
    for (const stream of INVOCATION_OUTPUT_STREAMS) {
      const links = await deps.harness.scriptUploads.mutate({ run: runId });
      if (links.outcome === "refused")
        return {
          output,
          failure: `the output could not be uploaded: ${links.reason}`,
        };
      const captured = run[stream];
      const failed = await uploadFile(
        links[stream],
        captured.path,
        captured.sizeBytes,
        reportBy,
      );
      if (failed)
        return {
          output,
          failure: `the script's ${stream} could not be uploaded: ${failed}`,
        };
      output[stream] = {
        sizeBytes: captured.sizeBytes,
        sha256: captured.sha256,
      };
    }
    return { output };
  }

  async function report(input: ScriptReportInput): Promise<void> {
    for (let attempt = 1; attempt <= REPORT_ATTEMPTS; attempt += 1) {
      try {
        const outcome = await deps.harness.reportScript.mutate(input);
        if (outcome.outcome === "refused")
          deps.log(`[invocation-script] report refused: ${outcome.reason}`);
        return;
      } catch (err) {
        deps.log(
          `[invocation-script] report attempt ${attempt} failed: ${(err as Error).message}`,
        );
        await new Promise((r) =>
          setTimeout(r, REPORT_RETRY_DELAY_MS * attempt),
        );
      }
    }
  }

  async function execute(
    payload: InvocationScriptEventPayload,
    stateDir: string,
    runId: string,
  ): Promise<void> {
    const deadline = new Date(payload.deadline);
    const key = runId.replace(/[^A-Za-z0-9_.-]/g, "_");
    const stdoutPath = join(stateDir, `stdout.${key}`);
    const stderrPath = join(stateDir, `stderr.${key}`);
    const stopped = new AbortController();
    runs.set(runId, stopped);
    deps.log(`[invocation-script] running in ${deps.workDir}`);
    let run: ScriptRun;
    try {
      run = await runScript({
        command: payload.command,
        cwd: deps.workDir,
        env: deps.spawnEnv(),
        deadline,
        stdoutPath,
        stderrPath,
        maxBytes: MAX_SCRIPT_OUTPUT_BYTES,
        signal: stopped.signal,
      });
    } finally {
      runs.delete(runId);
    }
    deps.log(
      `[invocation-script] ended: ${run.failure ?? `exit ${run.exitCode}`}`,
    );
    let uploaded: Awaited<ReturnType<typeof upload>>;
    try {
      uploaded = await upload(run, new Date(payload.reportBy), runId);
    } catch (err) {
      uploaded = {
        output: {},
        failure: `the output could not be uploaded: ${(err as Error).message}`,
      };
    }
    const failure = run.failure ?? uploaded.failure;
    await report({
      run: runId,
      exitCode: run.exitCode,
      output: uploaded.output,
      ...(failure !== undefined && {
        failure: failure.slice(0, SCRIPT_FAILURE_MAX_CHARS),
      }),
    });
    await rm(stdoutPath, { force: true });
    await rm(stderrPath, { force: true });
  }

  return {
    name: IMPL_NAME,
    isBusy: () => running > 0,
    stop(run) {
      const controller = runs.get(run);
      if (!controller) return false;
      controller.abort();
      return true;
    },
    bindEvent(kind: string, _binding: DriverBinding): EventHandler {
      if (kind !== "invocation-script") {
        throw new Error(
          `plugin "${IMPL_NAME}" does not handle event kind "${kind}"`,
        );
      }
      return async (payload, ctx) => {
        const parsed = invocationScriptEventPayload.parse(payload);
        const sentinel = join(
          ctx.pluginStateDir,
          `${STARTED_SENTINEL}.${ctx.eventId.replace(/[^A-Za-z0-9_.-]/g, "_")}`,
        );
        if (await sentinelExists(sentinel)) {
          deps.log(`[invocation-script] already started, skipping`);
          return;
        }
        await writeFile(sentinel, `${new Date().toISOString()}\n`, {
          flag: "wx",
        });
        running += 1;
        void execute(parsed, ctx.pluginStateDir, ctx.eventId)
          .catch((err: unknown) => {
            const message = (err as Error).message;
            deps.log(`[invocation-script] run failed: ${message}`);
            return report({
              run: ctx.eventId,
              exitCode: null,
              output: {},
              failure: `the script could not be run: ${message}`.slice(
                0,
                SCRIPT_FAILURE_MAX_CHARS,
              ),
            });
          })
          .finally(() => {
            running -= 1;
          });
      };
    },
  };
}
