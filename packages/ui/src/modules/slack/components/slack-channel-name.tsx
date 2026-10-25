import { Locked } from "@carbon/icons-react";
import type { SlackChannelChoiceView } from "api-server-api";

export function SlackChannelName({
  channel,
  showWorkspace,
}: {
  channel: SlackChannelChoiceView;
  showWorkspace: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {channel.isPrivate ? (
        <Locked
          size={12}
          className="shrink-0 text-muted-foreground"
          aria-label="Private channel"
        />
      ) : (
        <span className="text-muted-foreground" aria-hidden>
          #
        </span>
      )}
      <span className="truncate">{channel.name}</span>
      {showWorkspace && channel.workspace && (
        <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
          {channel.workspace}
        </span>
      )}
    </span>
  );
}
