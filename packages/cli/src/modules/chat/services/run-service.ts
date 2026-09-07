import { randomUUID } from "node:crypto";
import {
  platformPromptAcceptedParamsSchema,
  platformPromptStartedParamsSchema,
  platformRunResultResponseSchema,
  platformTurnEndedParamsSchema,
  PROMPT_QUEUE_FULL_CODE,
  SessionMode,
  SessionType,
  type PlatformRunResult,
} from "api-server-api";

import { err, ok, type Result } from "../../../result.js";
import {
  connectRun,
  type RpcOutcome,
  type RunConnection,
} from "../infrastructure/acp-run-connection.js";
import { acpUrl } from "../infrastructure/acp-session-client.js";
import type { BootstrapContext, BootstrapError } from "./bootstrap.js";

export const DEFAULT_RUN_TIMEOUT_SECONDS = 3600;

const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export type RunError =
  | BootstrapError
  | { kind: "run-failed"; reason: string; sessionId?: string };

export type RunOutcome =
  | { kind: "completed"; sessionId: string; stopReason: string | null }
  | { kind: "async-started"; sessionId: string }
  | { kind: "timed-out"; sessionId: string };

export type GetOutcome =
  | { kind: "done"; result: PlatformRunResult }
  | { kind: "pending"; sessionId: string }
  | { kind: "none"; sessionId: string }
  | { kind: "timed-out"; sessionId: string };

export type CancelOutcome =
  | { kind: "cancelled"; sessionId: string }
  | { kind: "not-running"; sessionId: string };

export interface RunService {
  run(input: {
    agentRef: string;
    serverFlag?: string;
    prompt: string;
    sessionId?: string;
    async?: boolean;
    timeoutSeconds: number;
  }): Promise<Result<RunOutcome, RunError>>;
  get(input: {
    agentRef: string;
    serverFlag?: string;
    sessionId: string;
    wait?: boolean;
    timeoutSeconds: number;
  }): Promise<Result<GetOutcome, RunError>>;
  cancel(input: {
    agentRef: string;
    serverFlag?: string;
    sessionId: string;
  }): Promise<Result<CancelOutcome, RunError>>;
}

export interface RunServiceDeps {
  bootstrap: (
    agentRef: string,
    serverFlag?: string,
  ) => Promise<Result<BootstrapContext, BootstrapError>>;
  out: (text: string) => void;
  errOut: (line: string) => void;
  onInterrupt?: (handler: () => void) => () => void;
}

type RunEvent =
  | { kind: "prompt-started" }
  | { kind: "prompt-queued" }
  | { kind: "turn-ended"; promptId: string | null; stopReason: string | null }
  | { kind: "prompt-response"; outcome: RpcOutcome };

interface Waiter {
  push(event: RunEvent): void;
  next(
    deadlineAt: number,
    closed: Promise<void>,
  ): Promise<RunEvent | "closed" | "timed-out">;
}

function createWaiter(): Waiter {
  const buffered: RunEvent[] = [];
  let wake: (() => void) | null = null;
  return {
    push(event) {
      buffered.push(event);
      wake?.();
    },
    async next(deadlineAt, closed) {
      for (;;) {
        const head = buffered.shift();
        if (head !== undefined) return head;
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) return "timed-out";
        let timer: ReturnType<typeof setTimeout>;
        let onClosed = false;
        await Promise.race([
          new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, remaining);
          }),
          closed.then(() => {
            onClosed = true;
          }),
        ]);
        wake = null;
        clearTimeout(timer!);
        if (buffered.length > 0) continue;
        if (onClosed) return "closed";
        if (Date.now() >= deadlineAt) return "timed-out";
      }
    },
  };
}

function extractText(params: unknown): string | null {
  if (typeof params !== "object" || params === null) return null;
  const update = (params as { update?: unknown }).update;
  if (typeof update !== "object" || update === null) return null;
  const u = update as Record<string, unknown>;
  if (u.sessionUpdate !== "agent_message_chunk") return null;
  const content = u.content;
  if (typeof content !== "object" || content === null) return null;
  const c = content as Record<string, unknown>;
  return c.type === "text" && typeof c.text === "string" ? c.text : null;
}

function sessionIdOf(params: unknown): string | null {
  if (typeof params !== "object" || params === null) return null;
  const sid = (params as { sessionId?: unknown }).sessionId;
  return typeof sid === "string" ? sid : null;
}

function matchesPrompt(result: PlatformRunResult, promptId: string): boolean {
  return result.promptId === promptId || result.promptId === null;
}

function resultSessionId(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const sid = (result as { sessionId?: unknown }).sessionId;
  return typeof sid === "string" && sid.length > 0 ? sid : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Drives a headless run over an agent's ACP relay:
 * open a Session tagged `cli_run`, submit one prompt, stream the assistant's
 * text, and map the prompt response's stopReason to the outcome. It never
 * answers permission requests — those are mirrored into the approvals queue,
 * and it prints where to act on them — and it survives a dropped socket: the
 * turn keeps running agent-side, so it reconnects with backoff, re-loads the
 * Session, and finishes from the pod's run-result record, printing only the
 * text it has not printed yet. `get` reads that record after the fact and can
 * wait for the turn to end; `cancel` sends `session/cancel` into a running
 * turn. One deliberate simplification: after a reconnect it stops streaming
 * and prints the remainder only at turn end — chunk-exact resume would need
 * frame identity the transcript replay does not carry.
 */
export function createRunService(deps: RunServiceDeps): RunService {
  async function connect(
    ctx: BootstrapContext,
    waiter: Waiter,
    sessionFilter: () => string | null,
    onText: (text: string) => void,
    onPromptStarted?: () => void,
  ): Promise<RunConnection | null> {
    let conn: RunConnection;
    try {
      conn = await connectRun({
        url: acpUrl(ctx.host, ctx.agentId, ctx.token),
        onPermissionRequest: () => {
          deps.errOut(
            "waiting on a permission request — approve it in the UI or with: dam approval list",
          );
        },
        onNotification: (method, params) => {
          const sid = sessionIdOf(params);
          if (sid === null || sid !== sessionFilter()) return;
          if (method === "session/update") {
            const text = extractText(params);
            if (text !== null) onText(text);
            return;
          }
          if (method === "platform/promptStarted") {
            const parsed = platformPromptStartedParamsSchema.safeParse(params);
            if (parsed.success) {
              onPromptStarted?.();
              waiter.push({ kind: "prompt-started" });
            }
            return;
          }
          if (method === "platform/promptAccepted") {
            const parsed = platformPromptAcceptedParamsSchema.safeParse(params);
            if (parsed.success && parsed.data.queued)
              waiter.push({ kind: "prompt-queued" });
            return;
          }
          if (method === "platform/turnEnded") {
            const parsed = platformTurnEndedParamsSchema.safeParse(params);
            waiter.push({
              kind: "turn-ended",
              promptId: parsed.success ? (parsed.data.promptId ?? null) : null,
              stopReason: parsed.success
                ? (parsed.data.stopReason ?? null)
                : null,
            });
          }
        },
      });
    } catch {
      return null;
    }
    const init = await conn.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "platform-cli-run", version: "1.0.0" },
    });
    if (!init.ok) {
      conn.close();
      return null;
    }
    return conn;
  }

  async function loadSession(
    conn: RunConnection,
    sessionId: string,
  ): Promise<
    Result<unknown, { kind: "run-failed"; reason: string; sessionId: string }>
  > {
    const loaded = await conn.request("session/load", {
      sessionId,
      cwd: ".",
      mcpServers: [],
      _meta: { platform: { tail: true } },
    });
    if (!loaded.ok) {
      return err({
        kind: "run-failed" as const,
        reason: `session '${sessionId}' could not be loaded: ${loaded.error.message}`,
        sessionId,
      });
    }
    return ok(loaded.result);
  }

  async function fetchRunResult(
    conn: RunConnection,
    sessionId: string,
  ): Promise<
    | { status: "done"; result: PlatformRunResult }
    | { status: "pending" }
    | { status: "none" }
    | null
  > {
    const res = await conn.request("platform/runResult", { sessionId });
    if (!res.ok) return null;
    const parsed = platformRunResultResponseSchema.safeParse(res.result);
    return parsed.success ? parsed.data : null;
  }

  async function reconnectAndFinish(opts: {
    ctx: BootstrapContext;
    sessionId: string;
    promptId: string;
    deadlineAt: number;
    printedChars: number;
  }): Promise<Result<RunOutcome, RunError>> {
    const { ctx, sessionId, promptId, deadlineAt } = opts;
    let backoffStep = 0;

    const finish = (
      result: PlatformRunResult,
    ): Result<RunOutcome, RunError> => {
      const remainder = result.finalText.slice(opts.printedChars);
      if (remainder.length > 0) deps.out(remainder);
      if (result.truncated)
        deps.errOut("note: the recorded run output was truncated");
      return ok({
        kind: "completed" as const,
        sessionId,
        stopReason: result.stopReason,
      });
    };

    for (;;) {
      if (Date.now() >= deadlineAt)
        return ok({ kind: "timed-out" as const, sessionId });
      const delay = RECONNECT_BACKOFF_MS[
        Math.min(backoffStep, RECONNECT_BACKOFF_MS.length - 1)
      ] as number;
      backoffStep += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));

      const waiter = createWaiter();
      const conn = await connect(
        ctx,
        waiter,
        () => sessionId,
        () => {},
      );
      if (conn === null) continue;
      deps.errOut("reconnected; waiting for the turn to finish");

      try {
        const loaded = await loadSession(conn, sessionId);
        if (!loaded.ok) return loaded;

        for (;;) {
          const record = await fetchRunResult(conn, sessionId);
          if (
            record?.status === "done" &&
            matchesPrompt(record.result, promptId)
          )
            return finish(record.result);

          const event = await waiter.next(deadlineAt, conn.closed);
          if (event === "timed-out")
            return ok({ kind: "timed-out" as const, sessionId });
          if (event === "closed") break;
          if (event.kind !== "turn-ended") continue;
          if (event.promptId !== null && event.promptId !== promptId) continue;
          const after = await fetchRunResult(conn, sessionId);
          if (after?.status === "done" && matchesPrompt(after.result, promptId))
            return finish(after.result);
          if (event.promptId === promptId) {
            deps.errOut(
              "note: the turn ended but no run record was found; output may be incomplete",
            );
            return ok({
              kind: "completed" as const,
              sessionId,
              stopReason: event.stopReason,
            });
          }
        }
      } finally {
        conn.close();
      }
    }
  }

  return {
    async run(input) {
      const ctx = await deps.bootstrap(input.agentRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      const deadlineAt = Date.now() + input.timeoutSeconds * 1000;
      const promptId = randomUUID();
      let sessionId: string | null = input.sessionId ?? null;
      const streaming = input.async !== true;
      let started = input.sessionId === undefined;
      let printedChars = 0;

      const waiter = createWaiter();
      const conn = await connect(
        ctx.value,
        waiter,
        () => sessionId,
        (text) => {
          if (!started || !streaming) return;
          deps.out(text);
          printedChars += text.length;
        },
        () => {
          started = true;
        },
      );
      if (conn === null)
        return err({
          kind: "run-failed" as const,
          reason: "could not connect to the agent",
        });

      let releaseInterrupt = (): void => {};
      try {
        if (sessionId === null) {
          const created = await conn.request("session/new", {
            cwd: ".",
            mcpServers: [],
            _meta: {
              platform: { mode: SessionMode.Chat, type: SessionType.CliRun },
            },
          });
          if (!created.ok)
            return err({
              kind: "run-failed" as const,
              reason: `session could not be created: ${created.error.message}`,
            });
          sessionId = resultSessionId(created.result);
          if (sessionId === null)
            return err({
              kind: "run-failed" as const,
              reason: "the agent returned no session id",
            });
        } else {
          const loaded = await loadSession(conn, sessionId);
          if (!loaded.ok) return loaded;
        }
        const sid = sessionId;

        releaseInterrupt =
          deps.onInterrupt?.(() => {
            deps.errOut("cancelling the run");
            conn.notify("session/cancel", { sessionId: sid });
          }) ?? ((): void => {});

        void conn
          .request("session/prompt", {
            sessionId: sid,
            prompt: [{ type: "text", text: input.prompt }],
            _meta: { platform: { promptId, surface: "cli" } },
          })
          .then((outcome) => {
            waiter.push({ kind: "prompt-response", outcome });
          });

        for (;;) {
          const event = await waiter.next(deadlineAt, conn.closed);
          if (event === "timed-out")
            return ok({ kind: "timed-out" as const, sessionId: sid });
          if (event === "closed") {
            deps.errOut(
              `connection lost mid-turn; the run continues on the agent (session ${sid})`,
            );
            return reconnectAndFinish({
              ctx: ctx.value,
              sessionId: sid,
              promptId,
              deadlineAt,
              printedChars,
            });
          }

          if (event.kind === "prompt-response") {
            const outcome = event.outcome;
            if (outcome.ok) {
              const stopReason =
                typeof (outcome.result as { stopReason?: unknown })
                  ?.stopReason === "string"
                  ? (outcome.result as { stopReason: string }).stopReason
                  : null;
              return ok({
                kind: "completed" as const,
                sessionId: sid,
                stopReason,
              });
            }
            if (outcome.error.message === "connection closed") {
              deps.errOut(
                `connection lost mid-turn; the run continues on the agent (session ${sid})`,
              );
              return reconnectAndFinish({
                ctx: ctx.value,
                sessionId: sid,
                promptId,
                deadlineAt,
                printedChars,
              });
            }
            const queueFull =
              typeof outcome.error.data === "object" &&
              outcome.error.data !== null &&
              (outcome.error.data as { code?: unknown }).code ===
                PROMPT_QUEUE_FULL_CODE;
            return err({
              kind: "run-failed" as const,
              reason: queueFull
                ? "the session's prompt queue is full — try again later"
                : `prompt failed: ${outcome.error.message}`,
              sessionId: sid,
            });
          }

          if (event.kind === "prompt-queued" && !started)
            deps.errOut("prompt queued behind a running turn; waiting");
          if (event.kind === "prompt-started") {
            started = true;
            if (input.async)
              return ok({ kind: "async-started" as const, sessionId: sid });
          }
        }
      } finally {
        releaseInterrupt();
        conn.close();
      }
    },

    async get(input) {
      const ctx = await deps.bootstrap(input.agentRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      const deadlineAt = Date.now() + input.timeoutSeconds * 1000;
      const sessionId = input.sessionId;
      let firstAttempt = true;

      for (;;) {
        if (!firstAttempt) {
          if (Date.now() >= deadlineAt)
            return ok({ kind: "timed-out" as const, sessionId });
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        firstAttempt = false;

        const waiter = createWaiter();
        const conn = await connect(
          ctx.value,
          waiter,
          () => sessionId,
          () => {},
        );
        if (conn === null) {
          if (input.wait) continue;
          return err({
            kind: "run-failed" as const,
            reason: "could not connect to the agent",
            sessionId,
          });
        }

        try {
          const record = await fetchRunResult(conn, sessionId);
          if (record === null)
            return err({
              kind: "run-failed" as const,
              reason:
                "the agent does not support run results — update its image",
              sessionId,
            });
          if (record.status === "done")
            return ok({ kind: "done" as const, result: record.result });
          if (record.status === "none" && !input.wait)
            return ok({ kind: "none" as const, sessionId });
          if (!input.wait) return ok({ kind: "pending" as const, sessionId });

          const loaded = await loadSession(conn, sessionId);
          if (!loaded.ok) return loaded;

          for (;;) {
            const event = await waiter.next(deadlineAt, conn.closed);
            if (event === "timed-out")
              return ok({ kind: "timed-out" as const, sessionId });
            if (event === "closed") break;
            if (event.kind !== "turn-ended") continue;
            const after = await fetchRunResult(conn, sessionId);
            if (after?.status === "done")
              return ok({ kind: "done" as const, result: after.result });
          }
        } finally {
          conn.close();
        }
      }
    },

    async cancel(input) {
      const ctx = await deps.bootstrap(input.agentRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      const sessionId = input.sessionId;
      const conn = await connect(
        ctx.value,
        createWaiter(),
        () => sessionId,
        () => {},
      );
      if (conn === null)
        return err({
          kind: "run-failed" as const,
          reason: "could not connect to the agent",
          sessionId,
        });
      try {
        const record = await fetchRunResult(conn, sessionId);
        if (record?.status !== "pending")
          return ok({ kind: "not-running" as const, sessionId });
        conn.notify("session/cancel", { sessionId });
        return ok({ kind: "cancelled" as const, sessionId });
      } finally {
        conn.close();
      }
    },
  };
}
