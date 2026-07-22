import { Add, Close } from "@carbon/icons-react";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../../types.js";
import {
  useConnectSlack,
  useDisconnectSlack,
  useUpdateAgent,
} from "../../../agents/api/mutations.js";
import { ChannelCard } from "./channel-card.js";

type SlackChannel = Extract<AgentView["channels"][number], { type: "slack" }>;

type AccessMode = "person-scoped" | "shared";

const MODE_OPTIONS: {
  value: AccessMode;
  label: string;
  description: string;
}[] = [
  {
    value: "person-scoped",
    label: "Person-scoped",
    description:
      "Each user links their own account; only the owner and allowed users drive the agent, each under their own credentials.",
  },
  {
    value: "shared",
    label: "Shared (system agent)",
    description:
      "Anyone in the channel drives the agent under the agent's credentials — no login. Turns are attributed by Slack user id, and your Terms-of-Use acceptance covers every turn.",
  },
];

export function SlackChannelCard({ agent }: { agent: AgentView | undefined }) {
  const slackChannel = agent?.channels.find(
    (c): c is SlackChannel => c.type === "slack",
  );
  const bound = !!slackChannel;

  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();
  const updateAgent = useUpdateAgent();

  const [enabled, setEnabled] = useState(bound);
  const [channelId, setChannelId] = useState(
    slackChannel?.slackChannelId ?? "",
  );
  const [mode, setMode] = useState<AccessMode>(
    slackChannel?.mode ?? "person-scoped",
  );
  const [ambient, setAmbient] = useState(slackChannel?.ambient ?? false);
  const [users, setUsers] = useState<string[]>(agent?.allowedUserEmails ?? []);
  const [userInput, setUserInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const channelIdError =
    submitted && enabled && !channelId.trim()
      ? "Enter the Slack channel ID."
      : undefined;

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
    setSubmitted(true);
    if (enabled && !channelId.trim()) return;
    setSaving(true);
    try {
      const id = channelId.trim();
      if (enabled && !slackChannel) {
        await connectSlack.mutateAsync({
          id: agent.id,
          slackChannelId: id,
          ...(mode === "shared" ? { mode } : {}),
          ...(mode === "shared" && ambient ? { ambient: true } : {}),
        });
      } else if (!enabled && slackChannel) {
        await disconnectSlack.mutateAsync({ id: agent.id });
      } else if (
        enabled &&
        slackChannel &&
        id !== slackChannel.slackChannelId
      ) {
        await disconnectSlack.mutateAsync({ id: agent.id });
        await connectSlack.mutateAsync({
          id: agent.id,
          slackChannelId: id,
          ...(mode === "shared" ? { mode } : {}),
          ...(mode === "shared" && ambient ? { ambient: true } : {}),
        });
      } else if (
        enabled &&
        slackChannel &&
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
      setSubmitted(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ChannelCard
      iconSlug="slack"
      title="Slack"
      headerRight={
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            setEnabled(v);
            setDirty(true);
          }}
          testId="slack-enabled-toggle"
          label="Slack enabled"
        />
      }
    >
      {enabled ? (
        <div className="flex flex-col gap-4 px-4 py-4">
          <FormField
            label="Channel ID"
            disableInset
            error={channelIdError}
            hint={
              bound
                ? undefined
                : "From the channel's details in Slack — starts with C."
            }
          >
            <Input
              value={channelId}
              variant={channelIdError ? "invalid" : undefined}
              aria-invalid={!!channelIdError}
              placeholder="C0…"
              data-testid="slack-channel-id"
              onChange={(e) => {
                setChannelId(e.target.value);
                setDirty(true);
              }}
            />
          </FormField>

          <div
            className="flex flex-col gap-2"
            role="radiogroup"
            aria-label="Access mode"
          >
            <SectionLabel>Access mode</SectionLabel>
            {MODE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  "flex items-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5",
                  bound ? "opacity-60" : "cursor-pointer",
                )}
              >
                <input
                  type="radio"
                  name="slack-access-mode"
                  value={opt.value}
                  checked={mode === opt.value}
                  disabled={bound}
                  aria-describedby={bound ? "slack-mode-locked" : undefined}
                  onChange={() => {
                    setMode(opt.value);
                    setDirty(true);
                  }}
                  className="mt-1"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-medium text-foreground">
                    {opt.label}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </label>
            ))}
            {bound && (
              <p
                id="slack-mode-locked"
                className="text-[13px] text-muted-foreground"
              >
                The mode is fixed per binding — disconnect and reconnect to
                change it.
              </p>
            )}
          </div>

          {mode === "shared" && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-foreground">
                  Ambient mode
                </span>
                <span className="text-[13px] text-muted-foreground">
                  The agent reads along in the channel and may chime in without
                  being mentioned when it can clearly help. The channel is
                  notified when this changes, and it can be turned off anytime —
                  here or with the in-chat ambient command.
                </span>
              </span>
              <Switch
                className="mt-0.5"
                checked={ambient}
                onCheckedChange={(v) => {
                  setAmbient(v);
                  setDirty(true);
                }}
                label="Ambient mode"
              />
            </div>
          )}

          {mode === "person-scoped" && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Allowed users</SectionLabel>
              {users.length === 0 && (
                <p className="text-[13px] text-muted-foreground">
                  Unrestricted — any linked Slack user can interact.
                </p>
              )}
              {users.map((u) => (
                <div
                  key={u}
                  className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5"
                >
                  <span className="flex-1 truncate font-mono text-[13px] text-foreground">
                    {u}
                  </span>
                  <Button
                    variant="ghost"
                    tone="danger"
                    size="icon-xs"
                    aria-label={`Remove ${u}`}
                    onClick={() => removeUser(u)}
                    className="shrink-0"
                  >
                    <Close size={14} />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  type="email"
                  className="h-[32px] flex-1"
                  value={userInput}
                  placeholder="user@example.com"
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && (e.preventDefault(), addUser())
                  }
                />
                <Button
                  variant="outline"
                  className="h-[32px] px-3 text-[14px] font-normal"
                  onClick={addUser}
                  disabled={!userInput.trim()}
                >
                  <Add size={16} />
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="px-4 py-4 text-[14px] text-muted-foreground">
          {bound
            ? "Saving will disconnect this channel."
            : "Not connected. Turn the switch on to bind a channel."}
        </p>
      )}
      {dirty && (
        <footer className="flex justify-end border-t border-border px-4 py-3">
          <Button
            onClick={() => void save()}
            disabled={saving}
            data-testid="slack-save"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </footer>
      )}
    </ChannelCard>
  );
}
