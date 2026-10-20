import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { getErrorMessage } from "../../../lib/errors.js";
import { emitToast } from "../../../lib/toast.js";
import { trpc } from "../../../trpc.js";
import { runNowErrorText } from "../lib/schedule-format.js";

const invalidatesScheduleList = {
  invalidates: [trpc.schedules.pathKey(), trpc.attention.pathKey()],
};

interface CreateScheduleInput {
  agentId: string;
  name: string;
  rrule: string;
  timezone: string;
  quietHours: { startTime: string; endTime: string; enabled: boolean }[];
  task: string;
  sessionMode: "fresh" | "continuous";
  precheck?: string;
  harness?: string;
  model?: string;
  settings?: Record<string, string>;
  sessionTitle?: string;
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
      errorToast: "Couldn't create schedule",
    },
  });
}

export interface UpdateCronScheduleInput {
  id: string;
  name: string;
  cron: string;
  task: string;
  sessionMode: "fresh" | "continuous";
  precheck: string | null;
  harness: string | null;
  model: string | null;
  settings: Record<string, string> | null;
  sessionTitle: string | null;
}

export function useUpdateCronSchedule() {
  return useMutation({
    mutationFn: (input: UpdateCronScheduleInput) =>
      api.schedules.updateCron.mutate({
        ...input,
        sessionMode:
          input.sessionMode === "fresh" ? undefined : input.sessionMode,
      }),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Couldn't update schedule",
    },
  });
}

interface UpdateScheduleInput {
  id: string;
  name: string;
  rrule: string;
  timezone: string;
  quietHours: { startTime: string; endTime: string; enabled: boolean }[];
  task: string;
  sessionMode: "fresh" | "continuous";
  precheck: string | null;
  harness: string | null;
  model: string | null;
  settings: Record<string, string> | null;
  sessionTitle: string | null;
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
      errorToast: "Couldn't update schedule",
    },
  });
}

export interface CreateOnceScheduleInput {
  agentId: string;
  name: string;
  task: string;
  timezone: string;
  at?: string;
  harness?: string;
  model?: string;
  settings?: Record<string, string>;
  sessionTitle?: string;
}

export function useCreateOnceSchedule() {
  return useMutation({
    mutationFn: (input: CreateOnceScheduleInput) =>
      api.schedules.createOnce.mutate(input),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Couldn't create one-time task",
    },
  });
}

export interface UpdateOnceScheduleInput {
  id: string;
  name: string;
  task: string;
  timezone: string;
  at: string;
  harness?: string;
  model?: string;
  settings?: Record<string, string>;
  sessionTitle?: string;
}

export function useUpdateOnceSchedule() {
  return useMutation({
    mutationFn: (input: UpdateOnceScheduleInput) =>
      api.schedules.updateOnce.mutate(input),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Couldn't update one-time task",
    },
  });
}

export function useToggleSchedule() {
  return useMutation({
    ...trpc.schedules.toggle.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Couldn't toggle schedule",
    },
  });
}

export function useDeleteSchedule() {
  return useMutation({
    ...trpc.schedules.delete.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Couldn't delete schedule",
    },
  });
}

export function useResetScheduleSession() {
  return useMutation({
    ...trpc.schedules.resetSession.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      errorToast: "Couldn't reset schedule session",
    },
  });
}

export function useRunScheduleNow() {
  return useMutation({
    ...trpc.schedules.runNow.mutationOptions(),
    meta: {
      ...invalidatesScheduleList,
      suppressErrorToast: true,
    },
    onError: (error) =>
      emitToast({
        kind: "error",
        message: runNowErrorText(getErrorMessage(error, "")),
      }),
  });
}
