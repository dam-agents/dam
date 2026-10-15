import { Edit } from "@carbon/icons-react";
import { AVATAR_CHARACTERS, AVATAR_EMOJI_RE } from "api-server-api/avatar/svg";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { authFetch } from "../../../../auth.js";
import { emitToast } from "../../../../lib/toast.js";
import { useFeatures } from "../../../features/api/queries.js";
import { useMarkAvatarPicked } from "../../../getting-started/api/mutations.js";
import { AvatarEgg } from "../../../getting-started/components/avatar-egg.js";
import { useOpenChecklist } from "../../../getting-started/hooks/use-open-checklist.js";
import {
  useFreshAvatars,
  useUnlockedAvatars,
} from "../../../getting-started/hooks/use-unlocked-avatars.js";
import { AgentAvatar } from "./agent-avatar.js";
import { NewAvatarDot } from "./new-avatar-dot.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The owner chooses one of the fixed avatar
 * characters for an agent. The trigger shows the current character and opens a
 * grid of all of them; a pick closes the grid. The figures are aria-hidden, so
 * every control carries the character's name for screen readers.
 */
export function AvatarPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (avatar: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasNew = useFreshAvatars().length > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={`Avatar: ${value}. Choose an avatar`}
        data-testid="avatar-picker"
        className="group relative flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted/40 disabled:opacity-50"
      >
        <AgentAvatar name="" avatar={value} size={36} />
        <span className="absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm group-hover:text-foreground">
          <Edit size={12} />
        </span>
        {hasNew && <NewAvatarDot className="-top-1 -right-1" />}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <AvatarGrid
          value={value}
          onPick={(character) => {
            onChange(character);
            setOpen(false);
          }}
          onLeave={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The grid of avatar characters. A user picks from
 * the characters they unlocked on the Get started checklist, plus the one the
 * agent already shows; the rest are eggs. Opening the grid clears the new
 * marks for good, but they stay on while it is open so the user sees which
 * characters are new. While any are locked, a link opens the
 * checklist so the user can see how to unlock them.
 */
export function AvatarGrid({
  value,
  onPick,
  onLeave,
}: {
  value: string;
  onPick: (avatar: string) => void;
  onLeave: () => void;
}) {
  const custom = useFeatures().data?.["custom-avatars"] ?? false;
  const unlocked = useUnlockedAvatars();
  const freshOnOpen = useFreshAvatars();
  const [fresh] = useState(freshOnOpen);
  const { mutate: markPicked } = useMarkAvatarPicked();
  useEffect(() => {
    for (const character of fresh) markPicked({ character });
  }, [fresh, markPicked]);
  const openChecklist = useOpenChecklist();
  const usable = AVATAR_CHARACTERS.filter(
    (c) => unlocked === null || c === value || unlocked.includes(c),
  );
  const locked = AVATAR_CHARACTERS.filter((c) => !usable.includes(c));
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Avatar" className="grid grid-cols-4 gap-2">
        {usable.map((character) => (
          <button
            key={character}
            type="button"
            aria-pressed={character === value}
            aria-label={character}
            onClick={() => onPick(character)}
            className={cn(
              "group relative flex size-14 items-center justify-center rounded-lg border transition-colors",
              character === value
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/40",
            )}
          >
            <AgentAvatar name="" avatar={character} size={36} />
            {fresh.includes(character) && (
              <>
                <NewAvatarDot className="top-1.5 right-1.5" />
                <span className="sr-only">New</span>
              </>
            )}
          </button>
        ))}
        {locked.map((character) => (
          <span
            key={character}
            role="img"
            aria-label="Locked avatar"
            className="flex size-14 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30"
          >
            <AvatarEgg className="size-7" />
          </span>
        ))}
      </div>
      {custom && <CustomAvatarInputs onPick={onPick} />}
      {locked.length > 0 && (
        <button
          type="button"
          onClick={() => {
            onLeave();
            openChecklist();
          }}
          className="self-start text-sm text-primary hover:underline"
        >
          See how to unlock the rest
        </button>
      )}
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The experimental custom avatars: one emoji typed
 * or pasted, or an uploaded JPG or PNG that the api-server crops to a square.
 */
function CustomAvatarInputs({ onPick }: { onPick: (avatar: string) => void }) {
  const [emoji, setEmoji] = useState("");
  const [uploading, setUploading] = useState(false);
  const validEmoji = AVATAR_EMOJI_RE.test(`emoji:${emoji.trim()}`);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const res = await authFetch("/api/avatars", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const body = (await res.json().catch(() => ({}))) as {
        avatar?: string;
        error?: string;
      };
      if (!res.ok || !body.avatar)
        throw new Error(body.error ?? `HTTP ${res.status}`);
      onPick(body.avatar);
    } catch (err) {
      emitToast({
        kind: "error",
        message: `Couldn't upload the avatar: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="flex items-center gap-2 border-t border-border pt-3">
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (validEmoji) onPick(`emoji:${emoji.trim()}`);
        }}
      >
        <Input
          size="sm"
          aria-label="Emoji avatar"
          placeholder="Emoji"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          className="w-20 text-center"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!validEmoji}
        >
          Use
        </Button>
      </form>
      <Button asChild size="sm" variant="outline" disabled={uploading}>
        <label>
          {uploading ? "Uploading…" : "Upload image"}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
      </Button>
    </div>
  );
}
