import { randomUUID } from "node:crypto";
import {
  SessionMode,
  SessionType,
  type SessionResolution,
  type SessionsApiService,
  type SessionView,
  type TerminalStrategy,
} from "api-server-api";
import {
  createAcpClient,
  type AcpSessionInfo,
} from "../../../core/acp-client.js";

export function createSessionsService(deps: {
  listByAgent: (agentId: string) => Promise<
    {
      sessionId: string;
      agentId: string;
      type: string;
      mode: string;
      scheduleId: string | null;
      scheduleActive: boolean;
      createdAt: Date;
    }[]
  >;
  listByScheduleId: (scheduleId: string) => Promise<
    {
      sessionId: string;
      agentId: string;
      type: string;
      mode: string;
      scheduleId: string | null;
      scheduleActive: boolean;
      createdAt: Date;
    }[]
  >;
  findActiveByScheduleId: (scheduleId: string) => Promise<{
    sessionId: string;
    agentId: string;
    type: string;
    mode: string;
    scheduleId: string | null;
    createdAt: Date;
  } | null>;
  upsert: (
    sessionId: string,
    agentId: string,
    mode: SessionMode,
    type?: SessionType,
    scheduleId?: string,
    threadTs?: string,
  ) => Promise<void>;
  setMode: (
    sessionId: string,
    agentId: string,
    mode: SessionMode,
  ) => Promise<void>;
  delete: (sessionId: string, agentId: string) => Promise<void>;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  isOwnedSchedule: (scheduleId: string) => Promise<boolean>;
  deactivateByScheduleId: (scheduleId: string) => Promise<void>;
  namespace: string;
  closeTerminalSession?: (sessionId: string) => void;
  notifyModeChange?: (
    agentId: string,
    sessionId: string,
    mode: SessionMode,
  ) => void;
}): SessionsApiService {
  const service: SessionsApiService = {
    async list(agentId: string, includeChannel?: boolean) {
      if (!(await deps.isOwnedAgent(agentId))) return [];
      // Reader only — the relay writes rows on first session/prompt. Writing
      // here would surface ACP-discovered probe sessions as orphan rows.
      const acp = createAcpClient({
        namespace: deps.namespace,
        instanceName: agentId,
      });

      const [dbRows, acpSessions] = await Promise.all([
        deps.listByAgent(agentId),
        acp.listSessions().catch((err) => {
          process.stderr.write(
            `[sessions] acp.listSessions failed for ${agentId}: ${err?.message ?? err}\n`,
          );
          return [] as AcpSessionInfo[];
        }),
      ]);

      const acpMap = new Map<string, AcpSessionInfo>(
        acpSessions.map((s) => [s.sessionId, s]),
      );

      // Always exclude schedule types from the main list
      const allowedTypes: string[] = [SessionType.Regular];
      if (includeChannel)
        allowedTypes.push(
          SessionType.ChannelSlack,
          SessionType.ChannelTelegram,
        );
      const filtered = dbRows.filter((r) => allowedTypes.includes(r.type));

      return filtered.map((row): SessionView => {
        const acp = acpMap.get(row.sessionId);
        return {
          sessionId: row.sessionId,
          agentId: row.agentId,
          type: row.type as SessionType,
          mode: row.mode as SessionMode,
          createdAt: row.createdAt.toISOString(),
          scheduleId: row.scheduleId,
          title: acp?.title ?? null,
          updatedAt: acp?.updatedAt ?? null,
        };
      });
    },

    async create(
      sessionId: string,
      agentId: string,
      mode: SessionMode,
      type?: SessionType,
      scheduleId?: string,
    ) {
      if (!(await deps.isOwnedAgent(agentId))) return;
      await deps.upsert(sessionId, agentId, mode, type, scheduleId);
    },

    async setMode(sessionId: string, agentId: string, mode: SessionMode) {
      if (!(await deps.isOwnedAgent(agentId))) return;
      await deps.setMode(sessionId, agentId, mode);
      if (mode !== SessionMode.Terminal) deps.closeTerminalSession?.(sessionId);
      deps.notifyModeChange?.(agentId, sessionId, mode);
    },

    async delete(sessionId: string, agentId: string) {
      if (!(await deps.isOwnedAgent(agentId))) return;
      await deps.delete(sessionId, agentId);
    },

    async listByScheduleId(scheduleId: string) {
      if (!(await deps.isOwnedSchedule(scheduleId))) return [];
      const rows = await deps.listByScheduleId(scheduleId);
      return rows.map(
        (row): SessionView => ({
          sessionId: row.sessionId,
          agentId: row.agentId,
          type: row.type as SessionType,
          mode: row.mode as SessionMode,
          createdAt: row.createdAt.toISOString(),
          scheduleId: row.scheduleId,
        }),
      );
    },

    async findByScheduleId(scheduleId: string) {
      const row = await deps.findActiveByScheduleId(scheduleId);
      return row
        ? {
            sessionId: row.sessionId,
            agentId: row.agentId,
            type: row.type as SessionType,
            mode: row.mode as SessionMode,
            createdAt: row.createdAt.toISOString(),
            scheduleId: row.scheduleId,
          }
        : null;
    },

    async resetByScheduleId(scheduleId: string) {
      if (!(await deps.isOwnedSchedule(scheduleId))) return;
      await deps.deactivateByScheduleId(scheduleId);
    },

    async resolveTerminal(
      agentId: string,
      strategy: TerminalStrategy,
      opts?: { reset?: boolean; force?: boolean },
    ): Promise<SessionResolution> {
      if (!(await deps.isOwnedAgent(agentId)))
        return { kind: "session-not-found", sessionId: "" };

      function terminalPath(sid: string) {
        return `/api/agents/${encodeURIComponent(agentId)}/terminal?sessionId=${encodeURIComponent(sid)}${opts?.reset ? "&reset=1" : ""}`;
      }

      if (strategy.kind === "new") {
        const sessionId = randomUUID();
        await deps.upsert(sessionId, agentId, SessionMode.Terminal);
        return {
          kind: "ready",
          sessionId,
          terminalPath: terminalPath(sessionId),
        };
      }

      const rows = await deps.listByAgent(agentId);
      const sessions = rows.filter((r) => r.type === SessionType.Regular);

      if (strategy.kind === "continue") {
        const terminals = sessions.filter(
          (s) => s.mode === SessionMode.Terminal,
        );
        if (terminals.length === 0) return { kind: "no-terminal-session" };
        if (terminals.length > 1)
          return {
            kind: "multiple-terminal-sessions",
            sessionIds: terminals.map((s) => s.sessionId),
          };
        return {
          kind: "ready",
          sessionId: terminals[0]!.sessionId,
          terminalPath: terminalPath(terminals[0]!.sessionId),
        };
      }

      const target = sessions.find((s) => s.sessionId === strategy.sessionId);
      if (!target)
        return { kind: "session-not-found", sessionId: strategy.sessionId };

      if (target.mode === SessionMode.Chat) {
        if (!opts?.force)
          return {
            kind: "confirm-mode-switch",
            sessionId: target.sessionId,
            currentMode: SessionMode.Chat,
          };
        await service.setMode(target.sessionId, agentId, SessionMode.Terminal);
      }

      return {
        kind: "ready",
        sessionId: target.sessionId,
        terminalPath: terminalPath(target.sessionId),
      };
    },
  };
  return service;
}
