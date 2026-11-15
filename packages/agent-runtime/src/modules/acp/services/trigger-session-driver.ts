import {
  NO_MODEL_REASON,
  PIN_MODEL_METHOD,
  type SessionDefaultKind,
} from "agent-runtime-api";
import { createInProcessCaller } from "../infrastructure/in-process-request.js";
import type { PlatformSessionMeta } from "../infrastructure/session-metadata-store.js";
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
    invocationRun?: string;
  }): Promise<{ sessionId: string; openedOn: string | null }>;
  // UNIT_BOUNDARY_DESCRIPTION: cancels the turn the session is running, as the Stop button in a chat does, and answers whether the turn ended within the wait; a session with no turn running has ended already.
  cancel(sessionId: string): Promise<boolean>;
}

const CANCEL_WAIT_MS = 60_000;
const CANCEL_POLL_MS = 500;

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
}): TriggerSessionDriver {
  return {
    async cancel(sessionId) {
      if (!deps.acpRuntime.isSessionRunning(sessionId)) return true;
      const caller = createInProcessCaller((channel) =>
        deps.acpRuntime.attach(channel, { viewer: false }),
      );
      try {
        await caller.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "platform-trigger", version: "1.0.0" },
        });
        caller.signal("session/cancel", { sessionId });
      } finally {
        caller.close();
      }
      const until = Date.now() + CANCEL_WAIT_MS;
      while (deps.acpRuntime.isSessionRunning(sessionId)) {
        if (Date.now() >= until) return false;
        await new Promise((r) => setTimeout(r, CANCEL_POLL_MS));
      }
      return true;
    },

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
      invocationRun,
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
        caller.notify("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: task }],
          ...((surface || invocationRun) && {
            _meta: {
              platform: {
                ...(surface && { surface }),
                ...(invocationRun && { invocationRun }),
              },
            },
          }),
        });

        return { sessionId, openedOn };
      } finally {
        caller.close();
      }
    },
  };
}
