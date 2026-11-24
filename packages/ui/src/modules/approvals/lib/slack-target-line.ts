import { match } from "ts-pattern";

import { formatDateTime } from "../../../lib/format-time.js";
import type { SlackMessageCall } from "./tool-call-renderers.js";

// UNIT_BOUNDARY_DESCRIPTION: the line above a Slack message preview that says where the message goes and how: to a conversation, in a thread or as a draft, when a scheduled one goes out, and that it goes as the person. The target shows by the name the api-server looked up, and by its Slack id when there is none.
export function slackTargetLine(call: SlackMessageCall): string {
  const name = call.target.label ?? call.target.id;
  const target =
    call.target.kind === "person" ? `${name} (direct message)` : name;
  const place = call.threadTs
    ? `Thread in ${target}`
    : call.delivery.kind === "draft"
      ? `Draft for ${target}`
      : `To ${target}`;
  const when = match(call.delivery)
    .with({ kind: "scheduled" }, ({ at }) => [
      `at ${formatDateTime(at, { dateStyle: "medium", timeStyle: "short" })}`,
    ])
    .otherwise(() => []);
  return [
    place,
    ...(call.alsoToChannel ? ["also sent to the conversation"] : []),
    ...when,
    "as you",
  ].join(" · ");
}
