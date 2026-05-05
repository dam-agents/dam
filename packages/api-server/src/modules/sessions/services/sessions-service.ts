import { SessionType, type SessionsApiService, type SessionView } from "api-server-api";
import { createAcpClient, type AcpSessionInfo } from "../../../core/acp-client.js";

export function createSessionsService(deps: {
  listByInstance: (instanceId: string) => Promise<{ sessionId: string; instanceId: string; type: string; scheduleId: string | null; scheduleActive: boolean; createdAt: Date }[]>;
  listByScheduleId: (scheduleId: string) => Promise<{ sessionId: string; instanceId: string; type: string; scheduleId: string | null; scheduleActive: boolean; createdAt: Date }[]>;
  findActiveByScheduleId: (scheduleId: string) => Promise<{ sessionId: string; instanceId: string; type: string; scheduleId: string | null; createdAt: Date } | null>;
  upsert: (sessionId: string, instanceId: string, type?: SessionType, scheduleId?: string) => Promise<void>;
  delete: (sessionId: string, instanceId: string) => Promise<void>;
  isOwnedInstance: (instanceId: string) => Promise<boolean>;
  isOwnedSchedule: (scheduleId: string) => Promise<boolean>;
  deactivateByScheduleId: (scheduleId: string) => Promise<void>;
  namespace: string;
}): SessionsApiService {
  return {
    async list(instanceId: string, includeChannel?: boolean) {
      if (!await deps.isOwnedInstance(instanceId)) return [];
      const acp = createAcpClient({
        namespace: deps.namespace,
        instanceName: instanceId,
        onSessionCreated: (sid) => deps.upsert(sid, instanceId, SessionType.Regular),
      });

      const [dbRows, acpSessions] = await Promise.all([
        deps.listByInstance(instanceId),
        acp.listSessions(),
      ]);

      const acpMap = new Map<string, AcpSessionInfo>(
        acpSessions.map((s) => [s.sessionId, s]),
      );

      // Always exclude schedule types from the main list
      const allowedTypes: string[] = [SessionType.Regular];
      if (includeChannel) allowedTypes.push(SessionType.ChannelSlack, SessionType.ChannelTelegram);
      const filtered = dbRows.filter((r) => allowedTypes.includes(r.type));

      return filtered.map((row): SessionView => {
        const acp = acpMap.get(row.sessionId);
        return {
          sessionId: row.sessionId,
          instanceId: row.instanceId,
          type: row.type as SessionType,
          createdAt: row.createdAt.toISOString(),
          scheduleId: row.scheduleId,
          title: acp?.title ?? null,
          updatedAt: acp?.updatedAt ?? null,
        };
      });
    },

    async create(sessionId: string, instanceId: string, type?: SessionType, scheduleId?: string) {
      if (!await deps.isOwnedInstance(instanceId)) return;
      await deps.upsert(sessionId, instanceId, type, scheduleId);
    },

    async delete(sessionId: string, instanceId: string) {
      if (!await deps.isOwnedInstance(instanceId)) return;
      await deps.delete(sessionId, instanceId);
    },

    async listByScheduleId(scheduleId: string) {
      if (!await deps.isOwnedSchedule(scheduleId)) return [];
      const rows = await deps.listByScheduleId(scheduleId);
      return rows.map((row): SessionView => ({
        sessionId: row.sessionId,
        instanceId: row.instanceId,
        type: row.type as SessionType,
        createdAt: row.createdAt.toISOString(),
        scheduleId: row.scheduleId,
      }));
    },

    async findByScheduleId(scheduleId: string) {
      const row = await deps.findActiveByScheduleId(scheduleId);
      return row
        ? {
            sessionId: row.sessionId,
            instanceId: row.instanceId,
            type: row.type as SessionType,
            createdAt: row.createdAt.toISOString(),
            scheduleId: row.scheduleId,
          }
        : null;
    },

    async resetByScheduleId(scheduleId: string) {
      if (!await deps.isOwnedSchedule(scheduleId)) return;
      await deps.deactivateByScheduleId(scheduleId);
    },
  };
}
