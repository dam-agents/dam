import { Checkmark, ChevronDown, Search } from "@carbon/icons-react";
import type { SlackChannelChoiceView } from "api-server-api";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { looksLikeChannelId, matchChannels } from "../lib/channel-choices.js";
import { SlackChannelName } from "./slack-channel-name.js";

type Option =
  | { kind: "channel"; channel: SlackChannelChoiceView; byId: boolean }
  | { kind: "unknown-id"; id: string };

function optionsFor(
  channels: readonly SlackChannelChoiceView[],
  query: string,
): Option[] {
  const text = query.trim();
  if (looksLikeChannelId(text)) {
    const channel = channels.find((c) => c.id === text);
    return channel
      ? [{ kind: "channel", channel, byId: true }]
      : [{ kind: "unknown-id", id: text }];
  }
  return matchChannels(channels, text).map((channel) => ({
    kind: "channel",
    channel,
    byId: false,
  }));
}

export function SlackChannelCombobox({
  inputId,
  channels,
  selected,
  onToggle,
  showWorkspace,
  bot,
}: {
  inputId: string;
  channels: readonly SlackChannelChoiceView[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  showWorkspace: boolean;
  bot: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [refusal, setRefusal] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const options = useMemo(() => optionsFor(channels, query), [channels, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const notShared = (id: string) =>
    `You and ${bot} aren't both in ${id}. Invite ${bot} to it, then refresh.`;

  const choose = (option: Option | undefined) => {
    if (!option) return;
    if (option.kind === "unknown-id") {
      setRefusal(notShared(option.id));
      return;
    }
    onToggle(option.channel.id);
    setQuery("");
    setHighlight(0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(options[highlight]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        <Search size={14} className="shrink-0 text-muted-foreground" />
        <input
          id={inputId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setRefusal(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search channels or paste a channel ID"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm outline-hidden placeholder:text-placeholder"
          data-testid="slack-channel-search"
        />
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </div>
      {open && (
        <div className="absolute z-popover mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable
            className="max-h-[240px] overflow-y-auto p-1"
          >
            {options.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                No channel by that name that you and {bot} are both in. Invite{" "}
                {bot} to it, then refresh.
              </li>
            )}
            {options.map((option, i) =>
              option.kind === "unknown-id" ? (
                <li
                  key={option.id}
                  className="px-3 py-2 text-sm text-muted-foreground"
                >
                  {notShared(option.id)}
                </li>
              ) : (
                <li
                  key={option.channel.id}
                  role="option"
                  aria-selected={selected.includes(option.channel.id)}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(option)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm",
                      i === highlight && "bg-muted",
                    )}
                  >
                    {option.byId && <span>Add</span>}
                    <SlackChannelName
                      channel={option.channel}
                      showWorkspace={showWorkspace}
                    />
                    {selected.includes(option.channel.id) && (
                      <Checkmark size={16} className="ml-2 shrink-0" />
                    )}
                  </button>
                </li>
              ),
            )}
          </ul>
          {query.trim() === "" && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Or paste the ID of a channel you and {bot} are both in.
            </p>
          )}
        </div>
      )}
      {refusal && (
        <p className="mt-1.5 text-sm text-danger" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}
