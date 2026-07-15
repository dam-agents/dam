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
import { useTelegramBot } from "../../telegram/api/queries.js";

export function ChannelsPanel() {
  const { data: agentsData } = useAgents();
  const agents = agentsData?.list ?? [];
  const availableChannels = agentsData?.availableChannels ?? {};
  const slackAvailable = !!availableChannels.slack;
  const telegramAvailable = !!availableChannels.telegram;

  const selectedAgent = useStore((s) => s.selectedAgent);
  const agent = agents.find((a) => a.id === selectedAgent);

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
      {telegramAvailable && <TelegramChannelInfo />}
    </div>
  );
}

function SlackChannelForm({ agent }: { agent: AgentView | undefined }) {
  const slackChannel = agent?.channels.find((c) => c.type === "slack");

  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();
  const updateAgent = useUpdateAgent();

  const [slackEnabled, setSlackEnabled] = useState(!!slackChannel);
  const [channelId, setChannelId] = useState(
    slackChannel?.type === "slack" ? slackChannel.slackChannelId : "",
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
            <SectionLabel>Allowed users</SectionLabel>
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

/** Telegram is a platform-wide bot; chats bind in-chat, not from here. */
function TelegramChannelInfo() {
  const bot = useTelegramBot();
  const handle = bot.data?.username;
  return (
    <fieldset className="rounded-lg border border-border p-4 flex flex-col gap-2">
      <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-foreground/80 px-1">
        Telegram
      </legend>
      <p className="text-[12px] text-muted-foreground">
        Telegram is available install-wide. Add{" "}
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
        to a chat (or message it directly) and send /login to connect the chat
        to one of your agents. Send /logout in the chat to disconnect.
      </p>
    </fieldset>
  );
}
