import type { Db } from "db";
import type { SessionsApiService, SessionMode } from "api-server-api";
import {
  listSessionsByAgent,
  listSessionsByScheduleId,
  findActiveByScheduleId,
  deactivateByScheduleId,
  upsertSession,
  deleteSession,
  setSessionMode,
} from "./infrastructure/sessions-repository.js";
import { createSessionsService } from "./services/sessions-service.js";

export function composeSessionsModule(deps: {
  db: Db;
  namespace: string;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
  isOwnedSchedule: (scheduleId: string) => Promise<boolean>;
  closeTerminalSession?: (sessionId: string) => void;
  notifyModeChange?: (
    agentId: string,
    sessionId: string,
    mode: SessionMode,
  ) => void;
}): {
  sessions: SessionsApiService;
} {
  return {
    sessions: createSessionsService({
      listByAgent: listSessionsByAgent(deps.db),
      listByScheduleId: listSessionsByScheduleId(deps.db),
      findActiveByScheduleId: findActiveByScheduleId(deps.db),
      upsert: upsertSession(deps.db),
      setMode: setSessionMode(deps.db),
      delete: deleteSession(deps.db),
      isOwnedAgent: deps.isOwnedAgent,
      isOwnedSchedule: deps.isOwnedSchedule,
      deactivateByScheduleId: deactivateByScheduleId(deps.db),
      namespace: deps.namespace,
      closeTerminalSession: deps.closeTerminalSession,
      notifyModeChange: deps.notifyModeChange,
    }),
  };
}
