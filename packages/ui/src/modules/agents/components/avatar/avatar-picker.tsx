import { AVATAR_CHARACTERS, AVATAR_EMOJI_RE } from "api-server-api/avatar/svg";
import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
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

const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 300;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The owner chooses one of the fixed avatar
 * characters for an agent. The grid opens like a tooltip when a mouse rests on
 * the trigger or the trigger takes focus, and stays while the pointer moves
 * into it; a click or Enter opens it and moves focus into the grid. A pick
 * closes the grid. The figures are aria-hidden, so every control carries the
 * character's name for screen readers.
 */
export function AvatarPicker({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (avatar: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const refocusing = useRef(false);
  const focusInside = useRef(false);
  const focusOnMount = useRef(false);
  const focusGrid = (grid: HTMLDivElement) =>
    (
      grid.querySelector<HTMLElement>("[aria-pressed=true]") ??
      grid.querySelector<HTMLElement>("button")
    )?.focus();
  useEffect(() => () => clearTimeout(timer.current), []);
  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!next && focusInside.current) return;
      setOpen(next);
    }, ms);
  };
  const set = (next: boolean) => {
    clearTimeout(timer.current);
    setOpen(next);
  };
  const hover = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "mouse") later(true, open ? 0 : HOVER_OPEN_MS);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === "mouse") later(false, HOVER_CLOSE_MS);
    },
  };
  return (
    <Popover open={open} onOpenChange={set}>
      <PopoverAnchor asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`Avatar: ${value}. Choose an avatar`}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="avatar-picker"
          className="relative flex shrink-0 rounded-md"
          {...hover}
          onFocus={(e) => {
            if (refocusing.current) refocusing.current = false;
            else if (e.currentTarget.matches(":focus-visible")) set(true);
          }}
          onClick={() => {
            set(true);
            if (gridRef.current) focusGrid(gridRef.current);
            else focusOnMount.current = true;
          }}
        >
          {children}
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-auto p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (!focusInside.current) return;
          focusInside.current = false;
          refocusing.current = true;
          triggerRef.current?.focus();
        }}
        onInteractOutside={(e) => {
          if (triggerRef.current?.contains(e.target as Node))
            e.preventDefault();
        }}
        {...hover}
      >
        <div
          ref={(el) => {
            gridRef.current = el;
            if (!el || !focusOnMount.current) return;
            focusOnMount.current = false;
            focusGrid(el);
          }}
          onFocus={() => (focusInside.current = true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget))
              focusInside.current = false;
          }}
        >
          <AvatarGrid
            value={value}
            onPick={(character) => {
              set(false);
              if (character !== value) onChange(character);
            }}
            onLeave={() => set(false)}
          />
        </div>
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
