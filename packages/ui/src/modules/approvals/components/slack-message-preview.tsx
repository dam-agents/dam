import { match } from "ts-pattern";

import { formatDateTime } from "../../../lib/format-time.js";
import type { SlackMessageCall } from "../lib/tool-call-renderers.js";

function deliveryLine(call: SlackMessageCall): string {
  const target =
    call.target.kind === "person"
      ? `the person ${call.target.id}`
      : call.target.id;
  const where = call.threadTs
    ? `a thread in ${target}${call.alsoToChannel ? ", also sent to the conversation" : ""}`
    : target;
  return match(call.delivery)
    .with({ kind: "post" }, () => `Posts as you to ${where}`)
    .with({ kind: "draft" }, () => `Saves a draft as you in ${where}`)
    .with(
      { kind: "scheduled" },
      ({ at }) =>
        `Schedules a post as you to ${where}, for ${formatDateTime(at, {
          dateStyle: "medium",
          timeStyle: "short",
        })}`,
    )
    .exhaustive();
}

export function SlackMessagePreview({ call }: { call: SlackMessageCall }) {
  return (
    <div data-testid="tool-call-slack-message" className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">{deliveryLine(call)}</p>
      <p className="max-h-60 overflow-y-auto rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-sm whitespace-pre-wrap break-words text-foreground">
        {call.text}
      </p>
    </div>
  );
}
