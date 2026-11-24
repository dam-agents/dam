import { slackTargetLine } from "../lib/slack-target-line.js";
import type { SlackMessageCall } from "../lib/tool-call-renderers.js";

export function SlackMessagePreview({ call }: { call: SlackMessageCall }) {
  return (
    <div
      data-testid="tool-call-slack-message"
      className="flex flex-col gap-1.5"
    >
      <p className="text-sm text-muted-foreground">{slackTargetLine(call)}</p>
      <p className="max-h-60 overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
        {call.text}
      </p>
    </div>
  );
}
