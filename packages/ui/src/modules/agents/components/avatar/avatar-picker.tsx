import { Edit } from "@carbon/icons-react";
import {
  AVATAR_CHARACTERS,
  type AvatarCharacter,
} from "api-server-api/avatar/svg";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { CharacterAvatar } from "./agent-avatar.js";

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
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={`Avatar: ${value}. Choose an avatar`}
        data-testid="avatar-picker"
        className="group relative flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted/40 disabled:opacity-50"
      >
        <CharacterAvatar name="" avatar={value} size={36} />
        <span className="absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm group-hover:text-foreground">
          <Edit size={12} />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div
          role="group"
          aria-label="Avatar"
          className="grid grid-cols-4 gap-2"
        >
          {AVATAR_CHARACTERS.map((character) => (
            <button
              key={character}
              type="button"
              aria-pressed={character === value}
              aria-label={character}
              onClick={() => {
                onChange(character);
                setOpen(false);
              }}
              className={cn(
                "group flex size-14 items-center justify-center rounded-lg border transition-colors",
                character === value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <CharacterAvatar name="" avatar={character} size={36} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
