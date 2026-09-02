import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { DialogActions } from "../../../../components/modal.js";

interface Props {
  onCancel: () => void;
  onSubmit: (channelId: string, ambient: boolean) => void;
}

export function ChannelIdForm({ onCancel, onSubmit }: Props) {
  const [channelId, setChannelId] = useState("");
  const [ambient, setAmbient] = useState(false);

  const canSubmit =
    channelId.trim().startsWith("C") && channelId.trim().length > 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">
          Channel ID
        </label>
        <Input
          className="h-10"
          placeholder="C0…"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          data-testid="bind-channel-id"
        />
        <p className="text-sm text-muted-foreground">
          From the channel's details in Slack — starts with C. The bot must
          already be in the channel.
        </p>
      </div>

      <AmbientRow checked={ambient} onChange={setAmbient} />

      <div className="flex items-center justify-end gap-3 pt-1">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit(channelId.trim(), ambient)}
          data-testid="bind-add-channel"
        >
          Add to channel
        </Button>
      </div>
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
        <span className="text-sm font-medium text-foreground">
          Ambient mode
        </span>
        <span className="text-sm text-muted-foreground">
          {checked
            ? "The agent reads every message here and answers when it can help. The channel is told, and you can turn this off anytime."
            : "Let it read along and answer without being mentioned."}
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
