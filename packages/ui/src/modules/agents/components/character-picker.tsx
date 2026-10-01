import { Edit, Locked } from "@carbon/icons-react";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  useEffect,
  useState,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  markCharacterSeen,
  useCharacterUnlocks,
} from "../lib/character-unlocks.js";
import { CatchStyles } from "./catch-styles.js";
import { CHAR_NAMES, CharAvatar, type CharName } from "./char-avatar.js";
import { MysteryAvatar } from "./mystery-avatar.js";

export const AvatarTrigger = forwardRef<
  HTMLButtonElement,
  Omit<ComponentPropsWithoutRef<"button">, "value"> & {
    value: CharName | null;
    hasNew?: boolean;
    active?: boolean;
    wobble?: boolean;
    pop?: boolean;
  }
>(function AvatarTrigger(
  { value, hasNew, active, wobble, pop, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={
        value ? "Choose an avatar" : "Your first avatar is a surprise"
      }
      {...rest}
      className={cn(
        "group relative flex size-16 shrink-0 items-center justify-center rounded-xl border bg-card transition-colors hover:bg-muted/40",
        value ? "border-border" : "border-dashed border-border",
        active && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className,
      )}
    >
      {value ? (
        <div
          key={value}
          className={cn(
            "flex",
            pop && "animate-[catch-pop_0.6s_cubic-bezier(0.34,1.56,0.64,1)]",
          )}
        >
          <CharAvatar name={value} state="running" className="size-12" />
        </div>
      ) : (
        <div
          className={cn(
            "flex",
            wobble && "animate-[catch-wobble_0.7s_ease-in-out_infinite]",
          )}
        >
          <MysteryAvatar className="size-10" />
        </div>
      )}
      {value && (
        <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors group-hover:text-foreground">
          <Edit size={16} />
        </span>
      )}
      {hasNew && (
        <span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-background bg-accent" />
      )}
    </button>
  );
});

export function AvatarTile({
  name,
  selected,
  isNew,
  onPick,
}: {
  name: CharName | null;
  selected?: boolean;
  isNew?: boolean;
  onPick?: () => void;
}) {
  const locked = name === null;
  return (
    <button
      type="button"
      aria-label={locked ? "Locked avatar" : "Avatar"}
      aria-pressed={selected}
      aria-disabled={locked}
      onClick={() => {
        if (!locked) onPick?.();
      }}
      className={cn(
        "relative flex size-16 items-center justify-center rounded-lg border transition-colors",
        locked
          ? "cursor-not-allowed border-dashed border-border bg-muted/30"
          : cn(
              "group",
              selected
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/40",
            ),
      )}
    >
      {locked ? (
        <MysteryAvatar className="size-9" />
      ) : (
        <CharAvatar name={name} state="running" className="size-11" />
      )}
      {locked && (
        <span className="absolute bottom-1 right-1 text-muted-foreground">
          <Locked size={16} />
        </span>
      )}
      {!locked && isNew && (
        <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" />
      )}
    </button>
  );
}

export function AvatarGrid({
  value,
  caught,
  fresh,
  onPick,
}: {
  value: CharName | null;
  caught: readonly CharName[];
  fresh: ReadonlySet<CharName>;
  onPick?: (name: CharName) => void;
}) {
  const slots: (CharName | null)[] = [
    ...caught,
    ...Array.from({ length: CHAR_NAMES.length - caught.length }, () => null),
  ];
  return (
    <>
      <SectionLabel className="mb-3 block">
        {caught.length === 0 ? "Your avatars" : "Choose an avatar"}
      </SectionLabel>
      <div className="grid grid-cols-4 gap-2">
        {slots.map((name, i) => {
          const tile = (
            <AvatarTile
              name={name}
              selected={name !== null && name === value}
              isNew={name !== null && fresh.has(name)}
              onPick={() => name && onPick?.(name)}
            />
          );
          return name === null ? (
            <Tooltip
              key={`locked-${i}`}
              content="Finish getting-started tasks to unlock more avatars"
              side="top"
              className="text-sm"
            >
              {tile}
            </Tooltip>
          ) : (
            <span key={name} className="contents">
              {tile}
            </span>
          );
        })}
      </div>
      <p className="mt-3 max-w-[280px] text-sm text-muted-foreground">
        {caught.length === 0
          ? "Create this agent to unlock your first avatar. It's a surprise!"
          : `${caught.length} of ${CHAR_NAMES.length} unlocked · finish getting-started tasks to unlock more`}
      </p>
    </>
  );
}

export function CharacterPicker({
  value,
  onChange,
  wobble,
  pop,
  caughtOverride,
}: {
  value: CharName | null;
  onChange: (name: CharName) => void;
  wobble?: boolean;
  pop?: boolean;
  caughtOverride?: readonly CharName[];
}) {
  const [open, setOpen] = useState(false);
  const unlocks = useCharacterUnlocks();
  const caught = caughtOverride ?? unlocks.caught;
  const fresh = caughtOverride ? new Set<CharName>() : unlocks.fresh;
  const { pickerRequest } = unlocks;

  useEffect(() => {
    if (pickerRequest === 0) return;
    const t = setTimeout(() => setOpen(true), 500);
    return () => clearTimeout(t);
  }, [pickerRequest]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <CatchStyles />
      <PopoverTrigger asChild>
        <AvatarTrigger
          value={value}
          hasNew={fresh.size > 0}
          active={open}
          wobble={wobble}
          pop={pop}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-4">
        <AvatarGrid
          value={value}
          caught={caught}
          fresh={fresh}
          onPick={(name) => {
            onChange(name);
            markCharacterSeen(name);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
