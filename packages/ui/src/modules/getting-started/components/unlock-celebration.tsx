import type { AvatarCharacter } from "api-server-api/avatar/svg";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import type { UnlockVariant } from "../lib/derive-checklist.js";
import { AvatarEgg } from "./avatar-egg.js";
import { ConfettiBurst } from "./confetti-burst.js";

const COPY: Record<UnlockVariant, { title: string; body: string }> = {
  "first-agent": {
    title: "You unlocked your first agent avatar!",
    body: "It's now your new agent's avatar. Finish the checklist to unlock more.",
  },
  new: {
    title: "You unlocked a new agent avatar!",
    body: "It's ready to pick the next time you create an agent.",
  },
  last: {
    title: "You unlocked every agent avatar!",
    body: "Your crew is complete. Pick any of them for your agents.",
  },
};

const AUTO_COLLECT_MS = 6500;
const COLLECT_MS = 450;

interface Props {
  character: AvatarCharacter;
  variant: UnlockVariant;
  onFinished: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The moment a user unlocks an avatar character.
 * An egg wobbles and cracks, the character pops out with confetti in its own
 * colors, and a short message says where the user can use it. After a few
 * seconds, or on "Nice", it shrinks into the checklist below, where the
 * character takes its place. The countdown waits while the pointer or focus is
 * on it, so nobody loses it mid-read (WCAG 2.2.1), and restarts in full after.
 */
export function UnlockCelebration({ character, variant, onFinished }: Props) {
  const [collecting, setCollecting] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const finished = useRef(onFinished);
  const copy = COPY[variant];

  useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setCollecting(true), AUTO_COLLECT_MS);
    return () => clearTimeout(t);
  }, [paused]);

  useEffect(() => {
    if (!collecting) return;
    const t = setTimeout(() => finished.current(), COLLECT_MS);
    return () => clearTimeout(t);
  }, [collecting]);

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      className={cn(
        "flex flex-col items-center gap-1 border-b border-border px-4 pt-2 pb-4 text-center",
        collecting && "animate-[unlock-collect_0.45s_ease-in_forwards]",
      )}
    >
      <div className="relative size-32 shrink-0">
        <ConfettiBurst character={character} />
        <div className="absolute inset-9 animate-[unlock-wobble_0.9s_ease-in-out]">
          <AvatarEgg
            part="bottom"
            className="absolute inset-0 size-full animate-[unlock-open-bottom_0.45s_ease-out_0.9s_forwards]"
          />
          <AvatarEgg
            part="top"
            className="absolute inset-0 size-full origin-bottom animate-[unlock-open-top_0.5s_ease-out_0.9s_forwards]"
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 animate-[unlock-pop_0.6s_cubic-bezier(0.34,1.56,0.64,1)_0.95s_forwards]">
          <AgentAvatar name="" avatar={character} size={96} playing />
        </div>
      </div>
      <div className="opacity-0 animate-[unlock-bubble_0.35s_ease-out_1.15s_forwards]">
        <p className="text-sm font-semibold text-foreground">{copy.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{copy.body}</p>
        <Button size="sm" className="mt-3" onClick={() => setCollecting(true)}>
          Nice
        </Button>
      </div>
    </div>
  );
}
