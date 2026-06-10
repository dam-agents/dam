import { Add as Plus, Close as X } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  useConnectSlack,
  useConnectTelegram,
  useDisconnectSlack,
  useDisconnectTelegram,
  useUpdateAgent,
} from "../../agents/api/mutations.js";
import { useAgents } from "../../agents/api/queries.js";

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
    <ChannelsForm
      key={agent?.id ?? "none"}
      agent={agent}
      slackAvailable={slackAvailable}
      telegramAvailable={telegramAvailable}
    />
  );
}

function ChannelsForm({
  agent,
  slackAvailable,
  telegramAvailable,
}: {
  agent: AgentView | undefined;
  slackAvailable: boolean;
  telegramAvailable: boolean;
}) {
  const slackChannel = agent?.channels.find((c) => c.type === "slack");
  const telegramChannel = agent?.channels.find((c) => c.type === "telegram");

  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();
  const connectTelegram = useConnectTelegram();
  const disconnectTelegram = useDisconnectTelegram();
  const updateAgent = useUpdateAgent();

  const [slackEnabled, setSlackEnabled] = useState(!!slackChannel);
  const [channelId, setChannelId] = useState(
    slackChannel?.type === "slack" ? slackChannel.slackChannelId : "",
  );
  const [telegramEnabled, setTelegramEnabled] = useState(!!telegramChannel);
  const [botToken, setBotToken] = useState("");
  const [editingBotToken, setEditingBotToken] = useState(!telegramChannel);
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
      if (telegramEnabled && !telegramChannel && botToken.trim()) {
        await connectTelegram.mutateAsync({
          id: agent.id,
          botToken: botToken.trim(),
        });
      } else if (!telegramEnabled && telegramChannel) {
        await disconnectTelegram.mutateAsync({ id: agent.id });
      } else if (telegramEnabled && telegramChannel && botToken.trim()) {
        await disconnectTelegram.mutateAsync({ id: agent.id });
        await connectTelegram.mutateAsync({
          id: agent.id,
          botToken: botToken.trim(),
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
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {slackAvailable && (
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
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                  Channel ID
                </label>
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
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                  Allowed users
                </label>
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
        </fieldset>
      )}

      {telegramAvailable && (
        <fieldset className="rounded-lg border border-border p-4 flex flex-col gap-3">
          <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-foreground/80 px-1">
            Telegram
          </legend>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={telegramEnabled}
              onCheckedChange={(c) => {
                setTelegramEnabled(c === true);
                if (c === true && !telegramChannel) setEditingBotToken(true);
                setDirty(true);
              }}
            />
            <span className="text-[13px] font-semibold text-foreground">
              Enabled
            </span>
          </label>

          {telegramEnabled && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                Bot token
              </label>
              {editingBotToken ? (
                <>
                  <Input
                    type="password"
                    value={botToken}
                    onChange={(e) => {
                      setBotToken(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="123456:ABC-..."
                    className="h-8"
                  />
                  <span className="text-[11px] text-muted-foreground mt-1">
                    Create a bot with @BotFather in Telegram and paste the token
                    here.
                  </span>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[13px] text-muted-foreground font-mono">
                    ••••••••
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingBotToken(true)}
                    className="h-7"
                  >
                    Change
                  </Button>
                </div>
              )}
            </div>
          )}
        </fieldset>
      )}

      <Button
        onClick={save}
        disabled={saving || !dirty}
        size="sm"
        className="self-start"
      >
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
