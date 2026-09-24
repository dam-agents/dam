import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { trpc } from "../../../trpc.js";

const invalidatesScheduleList = {
  invalidates: [trpc.schedules.pathKey()],
};

export interface CreateScheduleInput {
  agentId: string;
  name: string;
  rrule: string;
  timezone: string;
  quietHours: { startTime: string; endTime: string; enabled: boolean }[];
  task: string;
  sessionMode: "fresh" | "continuous";
  precheck?: string;
}

export function useCreateSchedule() {
  return useMutation({
    mutationFn: (input: CreateScheduleInput) =>
      api.schedules.createRRule.mutate({
        ...input,
        quietHours: input.quietHours.length > 0 ? input.quietHours : undefined,
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
  precheck: string | null;
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

export interface CreateOnceScheduleInput {
  agentId: string;
  name: string;
  task: string;
  timezone: string;
  at?: string;
  model?: string;
}

export function useCreateOnceSchedule() {
  return useMutation({
    mutationFn: (input: CreateOnceScheduleInput) =>
      api.schedules.createOnce.mutate(input),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to create one-time task",
    },
  });
}

export interface UpdateOnceScheduleInput {
  id: string;
  name: string;
  task: string;
  timezone: string;
  at: string;
  model?: string;
}

export function useUpdateOnceSchedule() {
  return useMutation({
    mutationFn: (input: UpdateOnceScheduleInput) =>
      api.schedules.updateOnce.mutate(input),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Failed to update one-time task",
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
