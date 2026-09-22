import { Renew } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { randomAvatarSeeds } from "../../lib/avatar/random-seed.js";
import { AgentAvatar } from "./agent-avatar.js";

export const AVATAR_CHOICE_COUNT = 5;

interface Props {
  value: string;
  onChange: (seed: string) => void;
  disabled?: boolean;
}

export function AvatarPicker({ value, onChange, disabled }: Props) {
  const [choices, setChoices] = useState(() =>
    randomAvatarSeeds(AVATAR_CHOICE_COUNT),
  );
  return (
    <div className="flex flex-wrap items-center gap-4">
      <AgentAvatar
        seed={value}
        size={64}
        label="Current avatar"
        className="rounded-lg bg-muted/60 p-1"
      />
      <div
        role="radiogroup"
        aria-label="Avatar choices"
        className="flex flex-wrap items-center gap-1.5"
      >
        {choices.map((seed, i) => {
          const selected = seed === value;
          return (
            <button
              key={seed}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Avatar choice ${i + 1}`}
              disabled={disabled}
              onClick={() => onChange(seed)}
              className={cn(
                "rounded-lg border p-1 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                selected
                  ? "border-primary bg-primary/10"
                  : "border-transparent hover:bg-muted",
              )}
            >
              <AgentAvatar seed={seed} size={40} />
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setChoices(randomAvatarSeeds(AVATAR_CHOICE_COUNT))}
      >
        <Renew size={16} />
        Reroll
      </Button>
    </div>
  );
}
