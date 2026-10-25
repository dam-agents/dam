import { Close } from "@carbon/icons-react";
import type { SlackChannelChoiceView } from "api-server-api";
import { useEffect, useId, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { TextSkeleton } from "@/components/ui/text-skeleton";

import { getBrand } from "../../../brand.js";
import { useSlackChannelChoices } from "../api/queries.js";
import { spansWorkspaces } from "../lib/channel-choices.js";
import { SlackChannelCombobox } from "./slack-channel-combobox.js";
import { SlackChannelName } from "./slack-channel-name.js";

// UNIT_BOUNDARY_DESCRIPTION: picks the Slack channels an agent connects to, by name. It offers only the channels the person and the bot are both in, because the server refuses any other connect; a pasted channel ID is matched against that same list, so it is accepted or refused before submit. The list is asked again whenever the picker opens or the window regains focus, because linking and channel membership change in Slack, where this page cannot see it; a pick the fresh list no longer holds is dropped, since the server would refuse it. A person whose Slack account is not linked gets no field, only the two ways that work for them: link the account, or bind from inside Slack.
export function SlackChannelPicker({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const inputId = useId();
  const choices = useSlackChannelChoices();
  const { name, short } = getBrand();
  const bot = `@${name}`;
  const refresh = (
    <Button
      type="button"
      variant="link"
      size="inline"
      onClick={() => void choices.refetch()}
    >
      refresh
    </Button>
  );

  const known = useMemo(
    () => (choices.data?.linked ? choices.data.channels : []),
    [choices.data],
  );

  useEffect(() => {
    if (!choices.data) return;
    const reachable = value.filter((id) => known.some((c) => c.id === id));
    if (reachable.length !== value.length) onChange(reachable);
  }, [choices.data, known, value, onChange]);
  const showWorkspace = spansWorkspaces(known);
  const toggle = (id: string) =>
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
    );

  const body = (() => {
    if (choices.isPending)
      return <TextSkeleton width="100%" className="h-10" />;
    if (choices.isError)
      return (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your Slack channels; {refresh} to try again.
        </p>
      );
    if (!choices.data.linked)
      return (
        <p className="text-sm text-muted-foreground">
          Link your Slack account to choose one of your channels here: run{" "}
          <code>/{short} login</code> in Slack, then {refresh}. Or run{" "}
          <code>/{short} bind</code> in the channel itself.
        </p>
      );
    const channels = choices.data.channels;
    if (channels.length === 0)
      return (
        <p className="text-sm text-muted-foreground">
          {bot} isn&apos;t in any channel you&apos;re in yet. Run{" "}
          <code>/invite {bot}</code> in the channel, then {refresh}.
        </p>
      );
    return (
      <>
        <label htmlFor={inputId}>
          <SectionLabel>Channels</SectionLabel>
        </label>
        <SlackChannelCombobox
          inputId={inputId}
          channels={channels}
          selected={value}
          onToggle={toggle}
          showWorkspace={showWorkspace}
          bot={bot}
        />
        <p className="text-sm text-muted-foreground">
          Lists the channels you and {bot} are both in, private ones included. A
          pasted channel ID works only for one of those. Missing one? Run{" "}
          <code>/invite {bot}</code> in it, then {refresh}.
        </p>
      </>
    );
  })();

  return (
    <div className="flex flex-col gap-2" data-testid="slack-channel-picker">
      {body}
      <PickedChannels
        ids={value}
        known={known}
        showWorkspace={showWorkspace}
        onRemove={toggle}
      />
    </div>
  );
}

function PickedChannels({
  ids,
  known,
  showWorkspace,
  onRemove,
}: {
  ids: readonly string[];
  known: readonly SlackChannelChoiceView[];
  showWorkspace: boolean;
  onRemove: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  const channels = ids.map(
    (id): SlackChannelChoiceView =>
      known.find((c) => c.id === id) ?? {
        id,
        name: id,
        isPrivate: false,
        workspace: null,
      },
  );
  return (
    <ul className="flex flex-wrap gap-1.5">
      {channels.map((channel) => (
        <li
          key={channel.id}
          className="flex h-7 max-w-full items-center gap-1 rounded-md border border-border bg-background pl-2.5 pr-1 text-sm"
        >
          <SlackChannelName channel={channel} showWorkspace={showWorkspace} />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onRemove(channel.id)}
            aria-label={`Remove ${channel.name}`}
          >
            <Close size={14} />
          </Button>
        </li>
      ))}
    </ul>
  );
}
