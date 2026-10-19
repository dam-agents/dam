import type { DefaultModelNotice } from "api-server-api";

export const defaultModelNoticeId = (notice: DefaultModelNotice): string =>
  `${notice.agentId}:${notice.state}`;

export const defaultModelStopsRuns = (
  notice: DefaultModelNotice | undefined,
): boolean => notice !== undefined && notice.state !== "changed";

export function defaultModelHeadline(notice: DefaultModelNotice): string {
  switch (notice.state) {
    case "not-set":
      return "No default model";
    case "no-provider":
      return "No model provider";
    case "provider-gone":
      return "Default model's provider is gone";
    case "changed":
      return "Default model changed";
  }
}

export function defaultModelDetail(notice: DefaultModelNotice): string {
  switch (notice.state) {
    case "not-set":
      return "Its schedules and Slack or Telegram turns won't run until you choose one.";
    case "no-provider":
      return "Attach a provider, then choose a model. Its schedules and Slack or Telegram turns won't run until then.";
    case "provider-gone":
      return `${notice.model ?? "Its default model"} is on a provider this agent no longer holds. Its schedules and Slack or Telegram turns won't run until you choose another.`;
    case "changed":
      return `${capitalized(notice.changedFrom ?? "its old model")} isn't offered by its provider, so it now runs ${notice.model ?? "another model"}.`;
  }
}

export function defaultModelAction(notice: DefaultModelNotice): string {
  switch (notice.state) {
    case "no-provider":
      return "Attach a provider";
    case "changed":
      return "Change";
    case "not-set":
    case "provider-gone":
      return "Choose a model";
  }
}

export function defaultModelScheduleWarning(
  notice: DefaultModelNotice,
): string {
  switch (notice.state) {
    case "no-provider":
      return "Won’t run: no model provider";
    case "provider-gone":
      return "Won’t run: default model’s provider is gone";
    case "not-set":
    case "changed":
      return "Won’t run: no default model";
  }
}

const capitalized = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);
