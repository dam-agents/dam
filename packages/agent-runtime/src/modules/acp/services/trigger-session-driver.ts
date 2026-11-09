import { PIN_MODEL_METHOD, type SessionDefaultKind } from "agent-runtime-api";
import { createInProcessCaller } from "../infrastructure/in-process-request.js";
import type { PlatformSessionMeta } from "../infrastructure/session-metadata-store.js";
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
 * UNIT_BOUNDARY_DESCRIPTION: a run that would start without a model on a
 * harness that needs one is not started, so no model the user never chose
 * runs it.
 */
export class NoSessionModelError extends Error {
  constructor() {
    super(
      "not run: the session has no model, and none of the agent's model providers lists one. Connect a model provider on its Providers page, or pick a model for this schedule",
    );
    this.name = "NoSessionModelError";
  }
}

export function createTriggerSessionDriver(deps: {
  acpRuntime: AcpRuntime;
  modelRequired: (harness: string | undefined) => boolean;
  modelMissing: (sessionId: string) => boolean;
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
      if (
        resumeSessionId
          ? !pins && deps.modelMissing(resumeSessionId)
          : !(model ?? platformMeta?.model) &&
            deps.modelRequired(platformMeta?.harness)
      )
        throw new NoSessionModelError();
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
                throw new SessionModelError(
                  model,
                  (err as Error).message,
                  resumeSessionId,
                );
              });
          const res = await caller.request<OpenedSession>("session/resume", {
            sessionId: resumeSessionId,
            cwd: ".",
            mcpServers: mcp,
          });
          sessionId = resumeSessionId;
          openedOn = openedModel(res);
          if (deps.modelMissing(sessionId)) throw new NoSessionModelError();
        } else {
          const res = await caller.request<
            OpenedSession & { sessionId: string }
          >("session/new", {
            cwd: ".",
            mcpServers: mcp,
            ...((platformMeta || model) && {
              _meta: {
                platform: { ...platformMeta, ...(model && { model }) },
              },
            }),
          });
          sessionId = res.sessionId;
          openedOn = openedModel(res);
        }

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
