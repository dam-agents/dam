import { Add as Plus, Close as X } from "@carbon/icons-react";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  useConnectSlack,
  useDisconnectSlack,
  useUpdateAgent,
} from "../../agents/api/mutations.js";
import { useAgents } from "../../agents/api/queries.js";
import { useUnbindTelegramChat } from "../../telegram/api/mutations.js";
import {
  useTelegramBot,
  useTelegramChats,
} from "../../telegram/api/queries.js";

export function ChannelsPanel({ agentId }: { agentId?: string } = {}) {
  const { data: agentsData } = useAgents();
  const agents = agentsData?.list ?? [];
  const availableChannels = agentsData?.availableChannels ?? {};
  const slackAvailable = !!availableChannels.slack;
  const telegramAvailable = !!availableChannels.telegram;

  const selectedAgent = useStore((s) => s.selectedAgent);
  const agent = agents.find((a) => a.id === (agentId ?? selectedAgent));

  if (!slackAvailable && !telegramAvailable) {
    return (
      <div className="px-4 py-4 text-[12px] text-muted-foreground">
        No channels are configured for this installation.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {slackAvailable && (
        <SlackChannelForm key={agent?.id ?? "none"} agent={agent} />
      )}
      {telegramAvailable && <TelegramChannelInfo agent={agent} />}
    </div>
  );
}

const MODE_OPTIONS = [
  {
    value: "person-scoped" as const,
    label: "Person-scoped",
    description:
      "Each user links their own account; only the owner and allowed users drive the agent, each under their own credentials.",
  },
  {
    value: "shared" as const,
    label: "Shared (system agent)",
    description:
      "Anyone in the channel drives the agent under the agent's credentials — no login. Turns are attributed by Slack user id, and your Terms-of-Use acceptance covers every turn.",
  },
];

function SlackChannelForm({ agent }: { agent: AgentView | undefined }) {
  const slackChannel = agent?.channels.find((c) => c.type === "slack");
  const bound = !!slackChannel;

  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();
  const updateAgent = useUpdateAgent();

  const [slackEnabled, setSlackEnabled] = useState(!!slackChannel);
  const [channelId, setChannelId] = useState(
    slackChannel?.type === "slack" ? slackChannel.slackChannelId : "",
  );
  const [mode, setMode] = useState<"shared" | "person-scoped">(
    slackChannel?.type === "slack"
      ? (slackChannel.mode ?? "person-scoped")
      : "person-scoped",
  );
  const [ambient, setAmbient] = useState(
    slackChannel?.type === "slack" ? (slackChannel.ambient ?? false) : false,
  );
  const [users, setUsers] = useState<string[]>(agent?.allowedUserEmails ?? []);
  const [userInput, setUserInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const addUser = () => {
    const v = userInput.trim();
    if (!v || users.includes(v)) return;
    setUsers((prev) => [...prev, v]);
    setUserInput("");
    setDirty(true);
  };

  const removeUser = (u: string) => {
    setUsers((prev) => prev.filter((x) => x !== u));
    setDirty(true);
  };

  const save = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      if (slackEnabled && !slackChannel && channelId.trim()) {
        await connectSlack.mutateAsync({
          id: agent.id,
          slackChannelId: channelId.trim(),
          ...(mode === "shared" ? { mode } : {}),
          ...(mode === "shared" && ambient ? { ambient: true } : {}),
        });
      } else if (!slackEnabled && slackChannel) {
        await disconnectSlack.mutateAsync({ id: agent.id });
      } else if (
        slackEnabled &&
        slackChannel &&
        slackChannel.type === "slack" &&
        channelId.trim() !== slackChannel.slackChannelId
      ) {
        await disconnectSlack.mutateAsync({ id: agent.id });
        await connectSlack.mutateAsync({
          id: agent.id,
          slackChannelId: channelId.trim(),
          ...(mode === "shared" ? { mode } : {}),
          ...(mode === "shared" && ambient ? { ambient: true } : {}),
        });
      } else if (
        slackEnabled &&
        slackChannel &&
        slackChannel.type === "slack" &&
        mode === "shared" &&
        ambient !== (slackChannel.ambient ?? false)
      ) {
        // Ambient is mutable (unlike mode): a same-mode re-connect updates
        // the existing binding in place.
        await connectSlack.mutateAsync({
          id: agent.id,
          slackChannelId: slackChannel.slackChannelId,
          mode: "shared",
          ...(ambient ? { ambient: true } : {}),
        });
      }
      await updateAgent.mutateAsync({
        id: agent.id,
        allowedUserEmails: users,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <fieldset className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-foreground/80 px-1">
        Slack
      </legend>

      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={slackEnabled}
          onCheckedChange={(c) => {
            setSlackEnabled(c === true);
            setDirty(true);
          }}
        />
        <span className="text-[13px] font-semibold text-foreground">
          Enabled
        </span>
      </label>

      {slackEnabled && (
        <>
          <FormField label="Channel ID" disableInset>
            <Input
              type="text"
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
                setDirty(true);
              }}
              placeholder="C0..."
              className="h-8"
            />
          </FormField>

          <div className="flex flex-col gap-1">
            <SectionLabel>Access mode</SectionLabel>
            {MODE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5 ${
                  bound ? "opacity-60" : "cursor-pointer"
                }`}
              >
                <input
                  type="radio"
                  name="slack-access-mode"
                  value={opt.value}
                  checked={mode === opt.value}
                  disabled={bound}
                  onChange={() => {
                    setMode(opt.value);
                    setDirty(true);
                  }}
                  className="mt-0.5"
                />
                <span className="flex flex-col">
                  <span className="text-[13px] font-semibold text-foreground">
                    {opt.label}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </label>
            ))}
            {bound && (
              <span className="text-[12px] text-muted-foreground italic">
                The mode is fixed per binding — disconnect and reconnect to
                change it.
              </span>
            )}
            {mode === "shared" && (
              <label className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5 cursor-pointer">
                <Checkbox
                  checked={ambient}
                  onCheckedChange={(c) => {
                    setAmbient(c === true);
                    setDirty(true);
                  }}
                  className="mt-0.5"
                />
                <span className="flex flex-col">
                  <span className="text-[13px] font-semibold text-foreground">
                    Ambient mode
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    The agent reads along in the channel and may chime in
                    without being mentioned when it can clearly help. The
                    channel is notified when this changes, and it can be
                    turned off anytime — here or with the in-chat ambient
                    command.
                  </span>
                </span>
              </label>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <SectionLabel>Allowed users</SectionLabel>
            {mode === "shared" && (
              <span className="text-[12px] text-muted-foreground italic">
                Not used in shared mode — channel membership is the gate.
              </span>
            )}
            {mode === "person-scoped" && (
              <>
                {users.length === 0 && (
                  <span className="text-[12px] text-muted-foreground italic">
                    Unrestricted — any linked Slack user can interact
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  {users.map((u) => (
                    <div
                      key={u}
                      className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1"
                    >
                      <span className="flex-1 text-[12px] font-mono text-foreground truncate">
                        {u}
                      </span>
                      <Button
                        variant="ghost"
                        tone="danger"
                        size="icon-xs"
                        onClick={() => removeUser(u)}
                        className="shrink-0"
                      >
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="email"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.preventDefault(), addUser())
                    }
                    placeholder="user@example.com"
                    className="flex-1 h-7"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={addUser}
                    disabled={!userInput.trim()}
                    className="h-7 w-7"
                  >
                    <Plus size={12} />
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <Button
        onClick={save}
        disabled={saving || !dirty}
        size="sm"
        className="self-start"
      >
        {saving ? "Saving..." : "Save"}
      </Button>
    </fieldset>
  );
}

/** Telegram is a platform-wide bot; chats bind via /login in the chat. */
function TelegramChannelInfo({ agent }: { agent: AgentView | undefined }) {
  const bot = useTelegramBot();
  const handle = bot.data?.username;

  return (
    <fieldset className="rounded-lg border border-border p-4 flex flex-col gap-2">
      <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-foreground/80 px-1">
        Telegram
      </legend>
      {agent && <TelegramConnectedChats agentId={agent.id} />}
      <p className="text-[12px] text-muted-foreground">
        Add{" "}
        {handle ? (
          <a
            className="underline text-foreground"
            href={`https://t.me/${handle}`}
            target="_blank"
            rel="noreferrer"
          >
            @{handle}
          </a>
        ) : (
          "this installation's Telegram bot"
        )}{" "}
        to a chat (or message it directly) and send /login to pick the agent in
        the browser. Send /logout in the chat to disconnect.
      </p>
    </fieldset>
  );
}

function TelegramConnectedChats({ agentId }: { agentId: string }) {
  const chats = useTelegramChats(agentId);
  const unbind = useUnbindTelegramChat();

  if (chats.isPending)
    return (
      <span className="text-[12px] text-muted-foreground">
        Loading connected chats…
      </span>
    );
  if (chats.isError || !chats.data) return null;
  if (chats.data.chats.length === 0)
    return (
      <span className="text-[12px] text-muted-foreground italic">
        No chats connected yet
      </span>
    );

  return (
    <div className="flex flex-col gap-1">
      <SectionLabel>Connected chats</SectionLabel>
      {chats.data.chats.map((chat) => (
        <div
          key={chat.conversationId}
          className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1"
        >
          <span className="flex-1 text-[12px] text-foreground truncate">
            {chat.title}
          </span>
          <Button
            variant="ghost"
            tone="danger"
            size="xs"
            disabled={unbind.isPending}
            onClick={() =>
              unbind.mutate({ agentId, conversationId: chat.conversationId })
            }
            className="shrink-0"
          >
            Disconnect
          </Button>
        </div>
      ))}
    </div>
  );
}
