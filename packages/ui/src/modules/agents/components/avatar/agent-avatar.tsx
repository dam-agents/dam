import "./agent-avatar.css";

import {
  avatarCharacter,
  avatarKey,
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
  stopped = false,
  working?: boolean,
): AvatarMood {
  if (stopped || state === "hibernated" || state === "hibernating")
    return "asleep";
  return working === false ? "idle" : "working";
}

interface Props {
  name: string;
  size?: number;
  mood?: AvatarMood;
  playing?: boolean;
  className?: string;
}

export function CharacterAvatar({
  name,
  size = 24,
  mood = "working",
  playing = false,
  className,
}: Props) {
  const key = avatarKey(getUser()?.profile.sub ?? "", name);
  const svg = useMemo(() => avatarSvg(key, mood), [key, mood]);
  return (
    <span
      data-testid="agent-avatar"
      data-character={avatarCharacter(key)}
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
