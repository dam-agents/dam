import "./agent-avatar.css";

import {
  type AvatarCharacter,
  avatarCharacter,
  type AvatarMood,
  avatarSvg,
} from "api-server-api/avatar/svg";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

import { getUser } from "../../../../auth.js";
import { useAgentAvatars } from "../../hooks/use-agent-avatars.js";
import type { AgentDisplayState } from "../../utils/agent-resolver.js";

export function avatarMood(
  state: AgentDisplayState | undefined,
  stopped: boolean | undefined,
  working: boolean,
): AvatarMood {
  if (stopped || state === "hibernated" || state === "hibernating")
    return "asleep";
  return working ? "working" : "idle";
}

export function resolveCharacter(
  name: string,
  avatar: string | null | undefined,
): AvatarCharacter {
  return avatarCharacter(
    avatar ?? undefined,
    getUser()?.profile.sub ?? "",
    name,
  );
}

interface Props {
  name: string;
  avatar?: string | null;
  size?: number;
  mood?: AvatarMood;
  playing?: boolean;
  className?: string;
}

export function CharacterAvatar({
  name,
  avatar,
  size = 24,
  mood = "working",
  playing = false,
  className,
}: Props) {
  const character = resolveCharacter(name, avatar);
  const svg = useMemo(() => avatarSvg(character, mood), [character, mood]);
  return (
    <span
      data-testid="agent-avatar"
      data-character={character}
      data-mood={mood}
      data-playing={playing || undefined}
      aria-hidden
      className={cn(
        "agent-avatar inline-block shrink-0 select-none",
        className,
      )}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function AgentAvatar(props: Props) {
  return useAgentAvatars() ? <CharacterAvatar {...props} /> : null;
}
