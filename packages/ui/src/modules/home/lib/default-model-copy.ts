import type { DefaultModelNotice } from "api-server-api";

export const defaultModelNoticeId = (notice: DefaultModelNotice): string =>
  `${notice.agentId}:${notice.state}`;

/** UNIT_BOUNDARY_DESCRIPTION: a default that does not run; "changed" runs, on another model than its old setting named. */
export const defaultModelBlocks = (
  notice: DefaultModelNotice | undefined,
): boolean => notice !== undefined && notice.state !== "changed";

export function defaultModelHeadline(notice: DefaultModelNotice): string {
  switch (notice.state) {
    case "not-set":
      return "No default model";
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
    case "provider-gone":
      return `${notice.model ?? "Its default model"} is on a provider this agent no longer holds. Its schedules and Slack or Telegram turns won't run until you choose another.`;
    case "changed":
      return `${capitalized(notice.changedFrom ?? "its old model")} isn't offered by its provider, so it now runs ${notice.model ?? "another model"}.`;
  }
}

const capitalized = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);
