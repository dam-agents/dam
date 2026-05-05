import type { Db } from "db";
import type { SessionsApiService } from "api-server-api";
import {
  listSessionsByInstance, listSessionsByScheduleId, findActiveByScheduleId,
  deactivateByScheduleId, upsertSession, deleteSession,
} from "./infrastructure/sessions-repository.js";
import { createSessionsService } from "./services/sessions-service.js";

export function composeSessionsModule(deps: {
  db: Db;
  namespace: string;
  isOwnedInstance: (instanceId: string) => Promise<boolean>;
  isOwnedSchedule: (scheduleId: string) => Promise<boolean>;
}): {
  sessions: SessionsApiService;
} {
  return {
    sessions: createSessionsService({
      listByInstance: listSessionsByInstance(deps.db),
      listByScheduleId: listSessionsByScheduleId(deps.db),
      findActiveByScheduleId: findActiveByScheduleId(deps.db),
      upsert: upsertSession(deps.db),
      delete: deleteSession(deps.db),
      isOwnedInstance: deps.isOwnedInstance,
      isOwnedSchedule: deps.isOwnedSchedule,
      deactivateByScheduleId: deactivateByScheduleId(deps.db),
      namespace: deps.namespace,
    }),
  };
}
