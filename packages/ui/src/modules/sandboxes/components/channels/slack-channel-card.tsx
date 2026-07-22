import { Add, Close } from "@carbon/icons-react";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../../types.js";
import type { SlackAccessMode } from "../../hooks/use-slack-channel-form.js";
import { useSlackChannelForm } from "../../hooks/use-slack-channel-form.js";
import { ChannelCard } from "./channel-card.js";

const MODE_OPTIONS: {
  value: SlackAccessMode;
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
  const f = useSlackChannelForm(agent);

  return (
    <ChannelCard
      iconSlug="slack"
      title="Slack"
      headerRight={
        <Switch
          checked={f.enabled}
          onCheckedChange={f.setEnabled}
          testId="slack-enabled-toggle"
          label="Slack enabled"
        />
      }
    >
      {f.enabled ? (
        <div className="flex flex-col gap-4 px-4 py-4">
          <FormField
            label="Channel ID"
            disableInset
            error={f.channelIdError}
            hint={
              f.bound
                ? undefined
                : "From the channel's details in Slack — starts with C."
            }
          >
            <Input
              value={f.channelId}
              variant={f.channelIdError ? "invalid" : undefined}
              aria-invalid={!!f.channelIdError}
              placeholder="C0…"
              data-testid="slack-channel-id"
              onChange={(e) => f.setChannelId(e.target.value)}
            />
          </FormField>

          <AccessModePicker
            mode={f.mode}
            locked={f.bound}
            onChange={f.setMode}
          />

          {f.mode === "shared" && (
            <AmbientRow checked={f.ambient} onChange={f.setAmbient} />
          )}

          {f.mode === "person-scoped" && (
            <AllowedUsers
              users={f.users}
              userInput={f.userInput}
              onUserInput={f.setUserInput}
              onAdd={f.addUser}
              onRemove={f.removeUser}
            />
          )}
        </div>
      ) : (
        <p className="px-4 py-4 text-[14px] text-muted-foreground">
          {f.bound
            ? "Saving will disconnect this channel."
            : "Not connected. Turn the switch on to bind a channel."}
        </p>
      )}
      {f.dirty && (
        <footer className="flex justify-end border-t border-border px-4 py-3">
          <Button
            onClick={() => void f.save()}
            disabled={f.saving}
            data-testid="slack-save"
          >
            {f.saving ? "Saving…" : "Save"}
          </Button>
        </footer>
      )}
    </ChannelCard>
  );
}

function AccessModePicker({
  mode,
  locked,
  onChange,
}: {
  mode: SlackAccessMode;
  locked: boolean;
  onChange: (mode: SlackAccessMode) => void;
}) {
  return (
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
            locked ? "opacity-60" : "cursor-pointer",
          )}
        >
          <input
            type="radio"
            name="slack-access-mode"
            value={opt.value}
            checked={mode === opt.value}
            disabled={locked}
            aria-describedby={locked ? "slack-mode-locked" : undefined}
            onChange={() => onChange(opt.value)}
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
      {locked && (
        <p id="slack-mode-locked" className="text-[13px] text-muted-foreground">
          The mode is fixed per binding — disconnect and reconnect to change it.
        </p>
      )}
    </div>
  );
}

function AmbientRow({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-medium text-foreground">
          Ambient mode
        </span>
        <span className="text-[13px] text-muted-foreground">
          The agent reads along in the channel and may chime in without being
          mentioned when it can clearly help. The channel is notified when this
          changes, and it can be turned off anytime — here or with the in-chat
          ambient command.
        </span>
      </span>
      <Switch
        className="mt-0.5"
        checked={checked}
        onCheckedChange={onChange}
        label="Ambient mode"
      />
    </div>
  );
}

function AllowedUsers({
  users,
  userInput,
  onUserInput,
  onAdd,
  onRemove,
}: {
  users: string[];
  userInput: string;
  onUserInput: (v: string) => void;
  onAdd: () => void;
  onRemove: (u: string) => void;
}) {
  return (
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
            onClick={() => onRemove(u)}
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
          onChange={(e) => onUserInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onAdd())}
        />
        <Button
          variant="outline"
          className="h-[32px] px-3 text-[14px] font-normal"
          onClick={onAdd}
          disabled={!userInput.trim()}
        >
          <Add size={16} />
          Add
        </Button>
      </div>
    </div>
  );
}
