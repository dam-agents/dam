import type { SlackMessageCall } from "../lib/tool-call-renderers.js";
import { SlackMarkup } from "./slack-markup.js";

export function SlackMessagePreview({
  message,
  sender,
}: {
  message: SlackMessageCall;
  sender: string;
}) {
  return (
    <div
      data-testid="tool-call-slack-message"
      className="rounded-lg border border-border bg-background px-3.5 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-bold text-foreground">{sender}</span>
        <span className="text-xs text-muted-foreground">
          how it will look in Slack
        </span>
      </div>
      <div className="mt-0.5 max-h-80 overflow-y-auto text-sm leading-relaxed text-foreground">
        <SlackMarkup text={message.text} />
      </div>
    </div>
  );
}
