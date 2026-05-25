import { Plus, X } from "lucide-react";
import { useState } from "react";

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
      <div className="px-4 py-4 text-[12px] text-text-muted">
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
        <fieldset className="rounded-lg border-2 border-border p-4 flex flex-col gap-3">
          <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-text-secondary px-1">
            Slack
          </legend>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={slackEnabled}
              onChange={(e) => {
                setSlackEnabled(e.target.checked);
                setDirty(true);
              }}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
            <span className="text-[13px] font-semibold text-text">Enabled</span>
          </label>

          {slackEnabled && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">
                  Channel ID
                </label>
                <input
                  type="text"
                  value={channelId}
                  onChange={(e) => {
                    setChannelId(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="C0..."
                  className="h-8 rounded-md border border-border-light bg-bg px-3 text-[13px] text-text outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">
                  Allowed users
                </label>
                {users.length === 0 && (
                  <span className="text-[12px] text-text-muted italic">
                    Unrestricted — any linked Slack user can interact
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  {users.map((u) => (
                    <div
                      key={u}
                      className="flex items-center gap-2 rounded-md border border-border-light bg-bg px-2 py-1"
                    >
                      <span className="flex-1 text-[12px] font-mono text-text truncate">
                        {u}
                      </span>
                      <button
                        onClick={() => removeUser(u)}
                        className="text-text-muted hover:text-danger shrink-0"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 mt-1">
                  <input
                    type="email"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.preventDefault(), addUser())
                    }
                    placeholder="user@example.com"
                    className="flex-1 h-7 rounded-md border border-border-light bg-bg px-2 text-[12px] text-text outline-none focus:border-accent"
                  />
                  <button
                    onClick={addUser}
                    disabled={!userInput.trim()}
                    className="h-7 w-7 rounded-md border border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent disabled:opacity-30"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            </>
          )}
        </fieldset>
      )}

      {telegramAvailable && (
        <fieldset className="rounded-lg border-2 border-border p-4 flex flex-col gap-3">
          <legend className="text-[12px] font-bold uppercase tracking-[0.05em] text-text-secondary px-1">
            Telegram
          </legend>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={telegramEnabled}
              onChange={(e) => {
                setTelegramEnabled(e.target.checked);
                if (e.target.checked && !telegramChannel)
                  setEditingBotToken(true);
                setDirty(true);
              }}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
            <span className="text-[13px] font-semibold text-text">Enabled</span>
          </label>

          {telegramEnabled && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">
                Bot token
              </label>
              {editingBotToken ? (
                <>
                  <input
                    type="password"
                    value={botToken}
                    onChange={(e) => {
                      setBotToken(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="123456:ABC-..."
                    className="h-8 rounded-md border border-border-light bg-bg px-3 text-[13px] text-text outline-none focus:border-accent"
                  />
                  <span className="text-[11px] text-text-muted mt-1">
                    Create a bot with @BotFather in Telegram and paste the token
                    here.
                  </span>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[13px] text-text-muted font-mono">
                    ••••••••
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingBotToken(true)}
                    className="h-7 px-2 rounded-md border border-border-light text-[11px] font-semibold text-text hover:border-accent hover:text-accent"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>
          )}
        </fieldset>
      )}

      <button
        onClick={save}
        disabled={saving || !dirty}
        className="btn-brutal h-8 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[12px] font-bold text-white disabled:opacity-40 self-start shadow-brutal-accent"
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
