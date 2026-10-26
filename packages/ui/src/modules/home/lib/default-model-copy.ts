import type { DefaultKind, DefaultModelNotice } from "api-server-api";

import { DEFAULT_KIND_LABEL } from "../../sessions/lib/default-kind.js";

export const defaultModelStopsRuns = (
  notice: DefaultModelNotice | undefined,
): boolean => notice !== undefined && notice.state !== "changed";

const ALL_KINDS: readonly DefaultKind[] = ["chat", "channel", "scheduled"];

/* UNIT_BOUNDARY_DESCRIPTION: what an agent-level default still governs — the
 * chat default stops new chats, and a channel or scheduled default saved before
 * profiles follows it (QA); channels and schedules with a profile of their own
 * are untouched. */
export function stoppedRuns(kinds: readonly DefaultKind[]): string {
  const runs = [
    "new chats",
    ...(kinds.includes("scheduled") ? ["schedules saved before profiles"] : []),
    ...(kinds.includes("channel")
      ? ["Slack or Telegram turns saved before profiles"]
      : []),
  ];
  return runs.length < 3
    ? runs.join(" and ")
    : `${runs[0]}, ${runs.slice(1).join(" and ")}`;
}

function kindQualifier(kinds: readonly DefaultKind[]): string {
  if (ALL_KINDS.every((kind) => kinds.includes(kind))) return "";
  return ` (${kinds.map((kind) => DEFAULT_KIND_LABEL[kind]).join(", ")})`;
}

export function defaultModelHeadline(notice: DefaultModelNotice): string {
  const qualifier = kindQualifier(notice.kinds);
  switch (notice.state) {
    case "not-set":
      return `No default model${qualifier}`;
    case "no-provider":
      return "No model provider";
    case "provider-gone":
      return `Default model's provider is gone${qualifier}`;
    case "changed":
      return `Default model changed${qualifier}`;
  }
}

export function defaultModelDetail(notice: DefaultModelNotice): string {
  const runs = stoppedRuns(notice.kinds);
  switch (notice.state) {
    case "not-set":
      return `Its ${runs} won't run until you choose one.`;
    case "no-provider":
      return `Attach a provider, then choose a model. Its ${runs} won't run until then.`;
    case "provider-gone":
      return `${notice.model ?? "Its default model"} is on a provider this agent no longer holds. Its ${runs} won't run until you choose another.`;
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
