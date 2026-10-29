import { randomUUID } from "node:crypto";
import {
  platformReplayTurnMetaSchema,
  platformTurnEndedParamsSchema,
  platformTurnStartedParamsSchema,
  type SessionView,
} from "api-server-api";

import { err, ok, type Result } from "../../../result.js";
import {
  connectRun,
  type RunConnection,
} from "../infrastructure/acp-run-connection.js";
import {
  acpUrl,
  toSessionView,
  type ListedSession,
} from "../infrastructure/acp-session-client.js";
import {
  createStepLog,
  type Step,
  type StepChange,
} from "../domain/session-steps.js";
import type { BootstrapContext, BootstrapError } from "./bootstrap.js";

export type ShowError =
  | BootstrapError
  | { kind: "session-failed"; reason: string }
  | { kind: "session-not-found"; sessionId: string };

export interface TurnState {
  running: boolean;
  turnStartedAt: string | null;
}

export type WatchEvent =
  { kind: "step"; change: StepChange } | { kind: "turn"; turn: TurnState };

export interface SessionWatch {
  session: SessionView;
  turn: TurnState;
  steps: readonly Step[];
  onEvent(listener: (event: WatchEvent) => void): void;
  closed: Promise<void>;
  close(): void;
}

export interface SessionShowService {
  open(input: {
    agentRef: string;
    serverFlag?: string;
    sessionId: string;
  }): Promise<Result<SessionWatch, ShowError>>;
}

export interface SessionShowServiceDeps {
  bootstrap: (
    agentRef: string,
    serverFlag?: string,
  ) => Promise<Result<BootstrapContext, BootstrapError>>;
  connect?: typeof connectRun;
  now?: () => Date;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function platformOf(value: unknown): Record<string, unknown> | null {
  return objectOf(objectOf(objectOf(value)?._meta)?.platform);
}

function stampOf(params: unknown): string | undefined {
  const at = platformOf(params)?.at;
  return typeof at === "string" && at !== "" ? at : undefined;
}

function turnFromLoad(result: unknown, listed: SessionView): TurnState {
  const parsed = platformReplayTurnMetaSchema.safeParse(
    platformOf(result)?.turn,
  );
  if (!parsed.success)
    return { running: listed.running === true, turnStartedAt: null };
  return {
    running: parsed.data.inFlight,
    turnStartedAt: parsed.data.inFlight
      ? (parsed.data.startedAt ?? null)
      : null,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Opens one Session of an Agent for reading, for
 * `dam session show`. Over one connection to the Agent's ACP relay it lists
 * the Agent's sessions, so an unknown id is refused before anything loads,
 * then loads the Session and reads its Session Transcript into steps. The load
 * answer says whether a turn is running and, from a runtime that knows it,
 * when that turn started. After the load, the same connection keeps hearing
 * the Session live: new steps, and `platform/turnStarted` and
 * `platform/turnEnded`, which the caller may follow until it closes. Every
 * turn end, replayed or live, closes the tool calls its turn left open; a
 * replayed one does not change the turn state, since the load answer already
 * says how the turn stands, and a load that finds no turn running closes what
 * is still open. It never sends a prompt and never answers a permission
 * request.
 */
export function createSessionShowService(
  deps: SessionShowServiceDeps,
): SessionShowService {
  const connect = deps.connect ?? connectRun;
  const now = deps.now ?? (() => new Date());

  return {
    async open(input) {
      const ctx = await deps.bootstrap(input.agentRef, input.serverFlag);
      if (!ctx.ok) return ctx;
      const { host, token, agentId } = ctx.value;

      const log = createStepLog();
      const listeners: ((event: WatchEvent) => void)[] = [];
      const emit = (event: WatchEvent) => {
        for (const listener of listeners) listener(event);
      };
      let loaded = false;
      let loadToken = "";
      const turn: TurnState = { running: false, turnStartedAt: null };

      let conn: RunConnection;
      try {
        conn = await connect({
          url: acpUrl(host, agentId, token),
          onPermissionRequest: () => {},
          onNotification: (method, params) => {
            if (objectOf(params)?.sessionId !== input.sessionId) return;
            if (method === "session/update") {
              const change = log.apply(params);
              if (change !== null && loaded) emit({ kind: "step", change });
              return;
            }
            const ended =
              method === "platform/turnEnded"
                ? platformTurnEndedParamsSchema.safeParse(params)
                : null;
            if (ended?.success) {
              const settled = log.settle(
                stampOf(params) ?? now().toISOString(),
                ended.data.stopReason,
              );
              if (loaded)
                for (const change of settled) emit({ kind: "step", change });
            }
            if (!loaded || platformOf(params)?.replayFor === loadToken) return;
            if (
              method === "platform/turnStarted" &&
              platformTurnStartedParamsSchema.safeParse(params).success
            ) {
              turn.running = true;
              turn.turnStartedAt = now().toISOString();
              emit({ kind: "turn", turn: { ...turn } });
              return;
            }
            if (ended?.success) {
              turn.running = false;
              turn.turnStartedAt = null;
              emit({ kind: "turn", turn: { ...turn } });
            }
          },
        });
      } catch (e) {
        return err({
          kind: "transport" as const,
          reason: e instanceof Error ? e.message : String(e),
        });
      }

      const fail = (reason: string) => {
        conn.close();
        return err({ kind: "session-failed" as const, reason });
      };

      const init = await conn.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "platform-cli-session-show", version: "1.0.0" },
      });
      if (!init.ok) return fail(init.error.message);

      const listed = await conn.request("session/list", { cwd: "." });
      if (!listed.ok) return fail(listed.error.message);
      const raw = objectOf(listed.result)?.sessions;
      const session = (Array.isArray(raw) ? raw : [])
        .map((s) => toSessionView(agentId, s as ListedSession))
        .find((s) => s.sessionId === input.sessionId);
      if (session === undefined) {
        conn.close();
        return err({
          kind: "session-not-found" as const,
          sessionId: input.sessionId,
        });
      }

      loadToken = randomUUID();
      const load = await conn.request("session/load", {
        sessionId: input.sessionId,
        cwd: ".",
        mcpServers: [],
        _meta: { platform: { loadToken } },
      });
      if (!load.ok)
        return fail(
          `session '${input.sessionId}' could not be loaded: ${load.error.message}`,
        );
      Object.assign(turn, turnFromLoad(load.result, session));
      if (!turn.running) log.settle(null);
      loaded = true;

      return ok({
        session,
        get turn() {
          return { ...turn };
        },
        steps: log.steps,
        onEvent(listener) {
          listeners.push(listener);
        },
        closed: conn.closed,
        close: () => conn.close(),
      });
    },
  };
}
