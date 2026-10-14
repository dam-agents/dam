import { Edit } from "@carbon/icons-react";
import {
  AVATAR_CHARACTERS,
  type AvatarCharacter,
} from "api-server-api/avatar/svg";
import { useEffect, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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
  value: AvatarCharacter;
  onChange: (character: AvatarCharacter) => void;
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
  value: AvatarCharacter;
  onPick: (character: AvatarCharacter) => void;
  onLeave: () => void;
}) {
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
