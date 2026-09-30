import { Edit } from "@carbon/icons-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { CHAR_NAMES, CharAvatar, type CharName } from "./char-avatar.js";

export function CharacterPicker({
  value,
  onChange,
}: {
  value: CharName;
  onChange: (name: CharName) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Choose a character"
          className={cn(
            "group relative flex size-16 shrink-0 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted/40",
            open && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
        >
          <CharAvatar name={value} state="running" className="size-12" />
          <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors group-hover:text-foreground">
            <Edit size={16} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-4">
        <SectionLabel className="mb-3 block">Choose a character</SectionLabel>
        <div className="grid grid-cols-4 gap-2">
          {CHAR_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              aria-label={`Character ${i + 1}`}
              aria-pressed={name === value}
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
              className={cn(
                "group flex size-16 items-center justify-center rounded-lg border transition-colors",
                name === value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <CharAvatar name={name} state="running" className="size-11" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
