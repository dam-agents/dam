import { AgentSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type { Stream } from "@agentclientprotocol/sdk/dist/stream.js";
import type {
  ContentBlock,
  SessionNotification,
} from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import {
  assistantMessagePayloadSchema,
  toolCallPayloadSchema,
  toolResultPayloadSchema,
  turnEndPayloadSchema,
  userMessagePayloadSchema,
  type TurnEvent,
} from "../domain/events.js";
import type { HostedSessionsService } from "./hosted-sessions-service.js";

const TAIL_POLL_MS = 700;
const QUEUE_POLL_MS = 1_000;
const TURN_CEILING_MS = 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function promptText(blocks: ContentBlock[]): string {
  return blocks
    .filter(
      (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
    )
    .map((b) => b.text)
    .join("\n");
}

function toolTitle(tool: string, args: unknown): string {
  if (tool === "bash" && args && typeof args === "object") {
    const cmd = (args as { command?: string }).command;
    if (cmd) return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
  }
  if (args && typeof args === "object") {
    const path = (args as { path?: string }).path;
    if (path) return `${tool} ${path}`;
  }
  return tool;
}

function eventToUpdates(event: TurnEvent): SessionNotification["update"][] {
  switch (event.kind) {
    case "user-message": {
      const p = userMessagePayloadSchema.parse(event.payload);
      return [
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: p.text },
        },
      ];
    }
    case "assistant-message": {
      const p = assistantMessagePayloadSchema.parse(event.payload);
      return [
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: p.text },
        },
      ];
    }
    case "tool-call": {
      const p = toolCallPayloadSchema.parse(event.payload);
      return [
        {
          sessionUpdate: "tool_call",
          toolCallId: p.callId,
          title: toolTitle(p.tool, p.args),
          status: "in_progress",
          rawInput: (p.args ?? {}) as Record<string, unknown>,
        },
      ];
    }
    case "tool-result": {
      const p = toolResultPayloadSchema.parse(event.payload);
      return [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: p.callId,
          status: p.isError ? "failed" : "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: p.output },
            },
          ],
        },
      ];
    }
    case "compaction":
    case "turn-end":
      return [];
  }
}

export function attachHostedAcp(opts: {
  stream: Stream;
  agentId: string;
  sessions: HostedSessionsService;
  isClientOpen: () => boolean;
  log: (msg: string) => void;
}): void {
  const { sessions } = opts;

  new AgentSideConnection(
    (conn) => ({
      async initialize(params) {
        return {
          protocolVersion: Math.min(params.protocolVersion ?? 1, 1),
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: false },
          },
        };
      },

      async newSession(params) {
        const meta = (params as { _meta?: { platform?: { mode?: string } } })
          ._meta?.platform;
        const session = await sessions.createSession({
          agentId: opts.agentId,
        });
        if (meta?.mode && meta.mode !== "chat") {
          await sessions.setMode(session.id, meta.mode);
        }
        return { sessionId: session.id };
      },

      async loadSession(params) {
        const events = await sessions.listEvents(params.sessionId);
        for (const event of events) {
          for (const update of eventToUpdates(event)) {
            await conn.sessionUpdate({ sessionId: params.sessionId, update });
          }
        }
        return {};
      },

      async listSessions() {
        const rows = await sessions.listSessions(opts.agentId);
        const withStatus = await Promise.all(
          rows.map(async (s) => ({
            sessionId: s.id,
            cwd: ".",
            title: s.title,
            updatedAt: s.updatedAt.toISOString(),
            _meta: {
              platform: {
                mode: s.mode,
                type: s.scheduleId ? "schedule_cron" : "regular",
                scheduleId: s.scheduleId ?? undefined,
                createdAt: s.createdAt.toISOString(),
                running: await sessions.turnInFlight(s.id),
                seenAt: s.lastSeenAt?.toISOString(),
              },
            },
          })),
        );
        return { sessions: withStatus };
      },

      async unstable_resumeSession(params) {
        const meta = (params as { _meta?: { platform?: { mode?: string } } })
          ._meta?.platform;
        if (meta?.mode) await sessions.setMode(params.sessionId, meta.mode);
        await sessions.recordSeen(params.sessionId);
        return {};
      },

      async setSessionMode(params) {
        await sessions.setMode(params.sessionId, params.modeId);
        return {};
      },

      async prompt(params) {
        const sessionId = params.sessionId;
        const meta = (
          params as { _meta?: { platform?: { promptId?: string } } }
        )._meta?.platform;
        const text = promptText(params.prompt);
        const existing = await sessions.listEvents(sessionId);
        let afterId = existing.at(-1)?.id ?? 0;

        const deadline = Date.now() + TURN_CEILING_MS;
        let accepted = await sessions.prompt({ sessionId, text });
        let queued = false;
        while ("refused" in accepted) {
          queued = true;
          if (Date.now() > deadline) throw new Error("prompt queue timeout");
          if (!opts.isClientOpen()) throw new Error("client gone");
          await sleep(QUEUE_POLL_MS);
          accepted = await sessions.prompt({ sessionId, text });
        }
        const turnId = accepted.turnId;
        if (meta?.promptId) {
          await conn.extNotification("platform/promptAccepted", {
            sessionId,
            promptId: meta.promptId,
            queued,
          });
          await conn.extNotification("platform/promptStarted", {
            sessionId,
            promptId: meta.promptId,
          });
        }

        while (Date.now() < deadline) {
          const events = await sessions.listEvents(sessionId, afterId);
          for (const event of events) {
            afterId = event.id;
            const ownPromptEcho =
              event.kind === "user-message" && event.turnId === turnId;
            if (!ownPromptEcho && opts.isClientOpen()) {
              for (const update of eventToUpdates(event)) {
                await conn.sessionUpdate({ sessionId, update });
              }
            }
            if (event.kind === "turn-end" && event.turnId === turnId) {
              const p = turnEndPayloadSchema.parse(event.payload);
              await conn
                .extNotification("platform/turnEnded", { sessionId })
                .catch(() => {});
              return {
                stopReason:
                  p.status === "done"
                    ? ("end_turn" as const)
                    : ("cancelled" as const),
              };
            }
          }
          if (!(await sessions.turnInFlight(sessionId))) {
            const drained = await sessions.listEvents(sessionId, afterId);
            const end = drained.find(
              (e) => e.kind === "turn-end" && e.turnId === turnId,
            );
            if (!end && drained.length === 0) {
              return { stopReason: "cancelled" as const };
            }
            continue;
          }
          await sleep(TAIL_POLL_MS);
        }
        return { stopReason: "cancelled" as const };
      },

      async cancel(params) {
        await sessions.interrupt(params.sessionId);
      },

      async unstable_closeSession() {
        return {};
      },

      async extMethod(method, params) {
        if (method === "platform/deleteSession") {
          const sessionId = (params as { sessionId?: string }).sessionId;
          if (sessionId) await sessions.deleteSession(sessionId);
          return {};
        }
        throw new Error(`unsupported ext method: ${method}`);
      },

      async extNotification() {},

      async authenticate() {
        return {};
      },
    }),
    opts.stream,
  );
}
