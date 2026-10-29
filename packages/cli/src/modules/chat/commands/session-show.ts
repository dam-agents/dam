import { Command } from "commander";

import { EXIT_INVALID_INPUT } from "../../shared/exit-codes.js";
import {
  elapsedMs,
  formatDuration,
  type Step,
} from "../domain/session-steps.js";
import type {
  SessionShowService,
  SessionWatch,
  ShowError,
  TurnState,
} from "../services/session-show-service.js";
import { exitCodeFor, printError } from "./chat.js";

const SUMMARY_MAX = 160;
const TEXT_MAX = 400;

function oneLine(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max
    ? collapsed
    : `${collapsed.slice(0, max - 1)}…`;
}

function clock(at: string | null): string {
  return at === null ? "--:--:--" : at.slice(11, 19) || "--:--:--";
}

export function stepLine(step: Step, now: number): string {
  if (step.kind === "message")
    return `${clock(step.at)}  ${step.role === "user" ? "user " : "agent"}  ${oneLine(step.text, TEXT_MAX)}`;
  const took =
    step.durationMs !== null
      ? formatDuration(step.durationMs)
      : step.startedAt !== null && step.endedAt === null
        ? `${formatDuration(elapsedMs(step.startedAt, now) ?? 0)} so far`
        : "-";
  return `${clock(step.startedAt)}  tool   ${step.tool} [${step.status}, ${took}] ${oneLine(step.summary, SUMMARY_MAX)}`;
}

export function turnLine(turn: TurnState, now: number): string {
  if (!turn.running) return "turn: idle";
  if (turn.turnStartedAt === null) return "turn: running (start unknown)";
  const ms = elapsedMs(turn.turnStartedAt, now);
  return `turn: running since ${turn.turnStartedAt}${ms === null ? "" : ` (${formatDuration(ms)})`}`;
}

export function showJson(watch: SessionWatch, now: number): object {
  const turn = watch.turn;
  return {
    session: watch.session,
    turn: {
      running: turn.running,
      turnStartedAt: turn.turnStartedAt,
      turnElapsedMs:
        turn.turnStartedAt === null ? null : elapsedMs(turn.turnStartedAt, now),
    },
    steps: watch.steps,
  };
}

function header(watch: SessionWatch, now: number): string {
  const s = watch.session;
  return [
    `session: ${s.sessionId}${s.title ? `  ${oneLine(s.title, 80)}` : ""}`,
    `type: ${s.type}   mode: ${s.mode}   created: ${s.createdAt}`,
    turnLine(watch.turn, now),
    "",
  ].join("\n");
}

function fail(e: ShowError): void {
  if (e.kind === "session-not-found") {
    process.stderr.write(
      `error: no session '${e.sessionId}' on this agent; list its sessions with: dam session list <agent>\n`,
    );
    process.exitCode = EXIT_INVALID_INPUT;
    return;
  }
  printError(e);
  process.exitCode = exitCodeFor(e);
}

export function buildSessionShowCommand(deps: {
  sessionShowService: SessionShowService;
  now?: () => number;
  onInterrupt?: (handler: () => void) => void;
}): Command {
  const now = deps.now ?? Date.now;
  return new Command("show")
    .description(
      "Show a session's messages and tool calls, newest last, and whether a turn is running",
    )
    .argument("<agent>", "agent name or ID")
    .argument("<session-id>", "session ID, from `dam session list`")
    .option("--server <url>", "override the configured server URL")
    .option("--json", "emit JSON instead of the default lines")
    .option(
      "--follow",
      "keep printing new messages and tool calls until stopped",
    )
    .action(
      async (
        agentRef: string,
        sessionId: string,
        opts: { server?: string; json?: boolean; follow?: boolean },
      ) => {
        const opened = await deps.sessionShowService.open({
          agentRef,
          serverFlag: opts.server,
          sessionId,
        });
        if (!opened.ok) {
          fail(opened.error);
          return;
        }
        const watch = opened.value;

        const write = (line: string) => process.stdout.write(`${line}\n`);
        const shown = [...watch.steps];
        const tail = shown.at(-1);
        let held: Step | null =
          opts.follow && watch.turn.running && tail?.kind === "message"
            ? (shown.pop() ?? null)
            : null;

        if (opts.json)
          write(JSON.stringify({ ...showJson(watch, now()), steps: shown }));
        else {
          process.stdout.write(header(watch, now()));
          for (const step of shown) write(stepLine(step, now()));
        }

        if (!opts.follow) {
          watch.close();
          return;
        }

        const emitStep = (step: Step) =>
          write(
            opts.json
              ? JSON.stringify({ event: "step", step })
              : stepLine(step, now()),
          );
        const flush = () => {
          if (held !== null) emitStep(held);
          held = null;
        };
        watch.onEvent((event) => {
          if (event.kind === "turn") {
            flush();
            write(
              opts.json
                ? JSON.stringify({ event: "turn", ...event.turn })
                : turnLine(event.turn, now()),
            );
            return;
          }
          const { step, added } = event.change;
          if (step.kind === "message") {
            if (step !== held) flush();
            held = step;
            return;
          }
          if (added || step.endedAt !== null) {
            flush();
            emitStep(step);
          }
        });
        deps.onInterrupt?.(() => watch.close());
        await watch.closed;
        flush();
      },
    );
}
