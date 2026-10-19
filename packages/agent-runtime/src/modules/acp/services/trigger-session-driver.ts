import { PIN_MODEL_METHOD } from "agent-runtime-api";
import { createInProcessCaller } from "../infrastructure/in-process-request.js";
import type { PlatformSessionMeta } from "../infrastructure/session-metadata-store.js";
import {
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
    model?: string;
    keepSessionModel?: boolean;
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
 * UNIT_BOUNDARY_DESCRIPTION: a run that would start without a model on a
 * harness that needs one is not started, so no model the user never chose
 * runs it.
 */
export class NoSessionModelError extends Error {
  constructor() {
    super(
      "not run: the session has no model. Set the agent's default model on its Providers page, or pick a model for this schedule",
    );
    this.name = "NoSessionModelError";
  }
}

export function createTriggerSessionDriver(deps: {
  acpRuntime: AcpRuntime;
  modelRequired?: (harness: string | undefined) => boolean;
  modelMissing?: (sessionId: string) => boolean;
}): TriggerSessionDriver {
  const missing = (sessionId: string) =>
    deps.modelMissing?.(sessionId) === true;
  return {
    async start({
      task,
      mcpServers,
      resumeSessionId,
      platformMeta,
      unattended,
      model,
      keepSessionModel,
    }) {
      if (
        !resumeSessionId &&
        !model &&
        deps.modelRequired?.(platformMeta?.harness) === true
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
          if (model && (!keepSessionModel || missing(resumeSessionId)))
            await caller
              .request(PIN_MODEL_METHOD, { sessionId: resumeSessionId, model })
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
          if (missing(sessionId)) throw new NoSessionModelError();
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

        caller.notify("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: task }],
          ...(unattended && {
            _meta: { platform: { surface: SCHEDULE_SURFACE } },
          }),
        });

        return { sessionId, openedOn };
      } finally {
        caller.close();
      }
    },
  };
}
