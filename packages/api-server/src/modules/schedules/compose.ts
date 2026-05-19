import type * as k8s from "@kubernetes/client-node";
import type { SchedulesService } from "api-server-api";
import { createK8sClient } from "../agents/infrastructure/k8s.js";
import { createSchedulesRepository } from "./infrastructure/schedules-repository.js";
import { createSchedulesService } from "./services/schedules-service.js";

export function composeSchedulesModule(
  api: k8s.CoreV1Api,
  namespace: string,
  owner: string,
): {
  schedules: SchedulesService;
  isOwnedSchedule: (scheduleId: string) => Promise<boolean>;
} {
  const k8s = createK8sClient(api, namespace);
  const repo = createSchedulesRepository(k8s);
  return {
    schedules: createSchedulesService({ repo, owner }),
    isOwnedSchedule: async (scheduleId) =>
      (await repo.get(scheduleId, owner)) !== null,
  };
}
