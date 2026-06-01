import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";

const invalidatesScheduleList = {
  invalidates: [trpc.schedules.list.queryKey()],
};

export interface CreateScheduleInput {
  agentId: string;
  name: string;
  rrule: string;
  timezone: string;
  quietHours: { startTime: string; endTime: string; enabled: boolean }[];
  task: string;
  sessionMode: "fresh" | "continuous";
}

export function useCreateSchedule() {
  return useMutation({
    mutationFn: (input: CreateScheduleInput) =>
      api.schedules.createRRule.mutate({
        ...input,
        quietHours: input.quietHours.length > 0 ? input.quietHours : undefined,
        // "fresh" is the absence of a persisted session on the wire.
        sessionMode:
          input.sessionMode === "fresh" ? undefined : input.sessionMode,
      }),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to create schedule",
    },
  });
}

export interface UpdateScheduleInput {
  id: string;
  name: string;
  rrule: string;
  timezone: string;
  quietHours: { startTime: string; endTime: string; enabled: boolean }[];
  task: string;
  sessionMode: "fresh" | "continuous";
}

export function useUpdateSchedule() {
  return useMutation({
    mutationFn: (input: UpdateScheduleInput) =>
      api.schedules.updateRRule.mutate({
        ...input,
        sessionMode:
          input.sessionMode === "fresh" ? undefined : input.sessionMode,
      }),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to update schedule",
    },
  });
}

export function useToggleSchedule() {
  return useMutation({
    ...trpc.schedules.toggle.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to toggle schedule",
    },
  });
}

export function useDeleteSchedule() {
  return useMutation({
    ...trpc.schedules.delete.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to delete schedule",
    },
  });
}

export function useResetScheduleSession() {
  return useMutation({
    ...trpc.schedules.resetSession.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to reset schedule session",
    },
  });
}
