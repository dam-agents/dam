import { randomUUID } from "node:crypto";
import {
  NO_MODEL_REASON,
  PIN_MODEL_METHOD,
  type SessionDefaultKind,
} from "agent-runtime-api";
import {
  ConnectionClosedError,
  createInProcessCaller,
  type InProcessCaller,
} from "../infrastructure/in-process-request.js";
import type {
  PlatformSessionMeta,
  SessionMetadataStore,
} from "../infrastructure/session-metadata-store.js";
import { PROVIDER_REMOVED_REASON } from "./lease-router.js";
import {
  MESSAGE_SURFACE,
  SCHEDULE_SURFACE,
  type AcpRuntime,
} from "./acp-runtime/acp-runtime.js";

export interface TriggerSessionDriver {
  start(opts: {
    task: string;
    mcpServers?: unknown[];
    resumeSessionId?: string;
    platformMeta?: PlatformSessionMeta;
    unattended?: boolean;
    steer?: boolean;
    model?: string;
    keepSessionModel?: boolean;
    follows?: SessionDefaultKind | null;
    onOpened?: (sessionId: string) => void;
  }): Promise<{ sessionId: string; openedOn: string | null }>;
}

interface OpenedSession {
  configOptions?: { id?: string; currentValue?: unknown }[];
  models?: { currentModelId?: string };
}

function openedModel(res: OpenedSession | null | undefined): string | null {
  const option = res?.configOptions?.find((o) => o.id === "model");
  if (typeof option?.currentValue === "string") return option.currentValue;
  return res?.models?.currentModelId ?? null;
}

export class SessionModelError extends Error {
  constructor(
    readonly model: string,
    cause: string,
    readonly sessionId?: string,
  ) {
    super(
      `the harness would not run this session on model "${model}": ${cause}`,
    );
    this.name = "SessionModelError";
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a run that no model can serve is refused by the
 * lease router, which holds the frame while a model may still arrive; this
 * error carries that refusal to the platform, as the runtime's own no-model
 * reason does, so a fire that ends without a model says a provider is missing.
 */
export class NoSessionModelError extends Error {
  constructor() {
    super(
      "not run: this agent has no model provider that serves this session. Connect a model provider on the agent's Providers page",
    );
    this.name = "NoSessionModelError";
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a fresh Session's first prompt was refused, or
 * never reached the Prompt Scheduler, so no turn ran and the Session holds
 * nothing. The run that opened it can be started again.
 */
export class PromptNotTakenError extends Error {
  constructor(
    readonly sessionId: string,
    cause: string,
  ) {
    super(`the session's first prompt was not taken: ${cause}`);
    this.name = "PromptNotTakenError";
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: how long a fresh Session's start waits for its
 * first turn. The prompt waits behind nothing but the Session's own settings,
 * so a refusal comes within seconds. A prompt still queued after this is left
 * to the runtime, which writes down a refusal it meets later: failing the
 * start then could run the task twice. A connection that closes once the
 * Prompt Scheduler queued the prompt is the runtime dropping that queue, which
 * it writes down the same way.
 */
const FIRST_TURN_WAIT_MS = 30_000;

function firstTurn(
  caller: InProcessCaller,
  params: { sessionId: string; prompt: unknown[]; surface: string | null },
): Promise<void> {
  const promptId = randomUUID();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, FIRST_TURN_WAIT_MS);
    timer.unref?.();
    const settle = (err?: unknown): void => {
      clearTimeout(timer);
      if (err === undefined) resolve();
      else reject(err as Error);
    };
    let accepted = false;
    caller.onNotification((method, notified) => {
      if (
        (notified as { promptId?: unknown } | undefined)?.promptId !== promptId
      )
        return;
      if (method === "platform/promptAccepted") accepted = true;
      if (method === "platform/promptStarted") settle();
    });
    caller
      .request("session/prompt", {
        sessionId: params.sessionId,
        prompt: params.prompt,
        _meta: {
          platform: {
            promptId,
            ...(params.surface && { surface: params.surface }),
          },
        },
      })
      .then(
        () => settle(),
        (err: unknown) =>
          settle(
            err instanceof ConnectionClosedError && accepted ? undefined : err,
          ),
      );
  });
}

function asNoSessionModel(err: unknown): never {
  const reason = platformReason(err);
  if (reason === NO_MODEL_REASON) throw new NoSessionModelError();
  throw err;
}

function platformReason(err: unknown): unknown {
  const data = (err as { data?: unknown } | null)?.data;
  return typeof data === "object" && data !== null
    ? (data as { platform?: { reason?: unknown } }).platform?.reason
    : undefined;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a pin from a fire is a preference, since the
 * model the fire names may belong to a provider the agent no longer holds; the
 * lease router then resolves one that serves, so the refusal to pin says so
 * instead of failing the run, and the pin the UI sends for a person stays
 * strict, since nobody would fall back for it.
 */
function pinUnusable(err: unknown): boolean {
  return [PROVIDER_REMOVED_REASON, NO_MODEL_REASON].includes(
    platformReason(err) as string,
  );
}

export function createTriggerSessionDriver(deps: {
  acpRuntime: AcpRuntime;
  modelMissing: (sessionId: string) => boolean;
  modelReady: (sessionId: string) => Promise<boolean>;
  log?: (msg: string) => void;
  sessionMetadata: Pick<SessionMetadataStore, "tombstone">;
}): TriggerSessionDriver {
  return {
    async start({
      task,
      mcpServers,
      resumeSessionId,
      platformMeta,
      unattended,
      steer,
      model,
      keepSessionModel,
      follows,
      onOpened,
    }) {
      const pins =
        !!resumeSessionId &&
        !!model &&
        (!keepSessionModel || deps.modelMissing(resumeSessionId));
      const caller = createInProcessCaller((channel) =>
        deps.acpRuntime.attach(channel, { viewer: false }),
      );

      try {
        await caller.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
          clientInfo: { name: "platform-trigger", version: "1.0.0" },
        });

        const mcp = (mcpServers ?? []) as unknown[];
        let sessionId: string;
        let openedOn: string | null;

        if (resumeSessionId) {
          const intent = follows === undefined ? {} : { follows };
          if (pins && model)
            await caller
              .request(PIN_MODEL_METHOD, {
                sessionId: resumeSessionId,
                model,
                ...intent,
              })
              .catch((err: unknown) => {
                if (pinUnusable(err)) {
                  deps.log?.(
                    `[trigger] ${resumeSessionId}: the pinned model ${model} cannot serve this run, so the router resolves one: ${(err as Error).message}`,
                  );
                  return;
                }
                throw new SessionModelError(
                  model,
                  (err as Error).message,
                  resumeSessionId,
                );
              });
          const res = await caller
            .request<OpenedSession>("session/resume", {
              sessionId: resumeSessionId,
              cwd: ".",
              mcpServers: mcp,
            })
            .catch(asNoSessionModel);
          sessionId = resumeSessionId;
          openedOn = openedModel(res);
        } else {
          const res = await caller
            .request<OpenedSession & { sessionId: string }>("session/new", {
              cwd: ".",
              mcpServers: mcp,
              ...((platformMeta || model) && {
                _meta: {
                  platform: { ...platformMeta, ...(model && { model }) },
                },
              }),
            })
            .catch(asNoSessionModel);
          sessionId = res.sessionId;
          openedOn = openedModel(res);
        }

        if (!(await deps.modelReady(sessionId)))
          throw new NoSessionModelError();

        const surface = steer
          ? MESSAGE_SURFACE
          : unattended
            ? SCHEDULE_SURFACE
            : null;
        const prompt = [{ type: "text", text: task }];
        onOpened?.(sessionId);
        if (resumeSessionId) {
          caller.notify("session/prompt", {
            sessionId,
            prompt,
            ...(surface && { _meta: { platform: { surface } } }),
          });
          return { sessionId, openedOn };
        }
        await firstTurn(caller, { sessionId, prompt, surface }).catch(
          (err: unknown) => {
            deps.sessionMetadata.tombstone(sessionId);
            throw new PromptNotTakenError(sessionId, (err as Error).message);
          },
        );
        return { sessionId, openedOn };
      } finally {
        caller.close();
      }
    },
  };
}
