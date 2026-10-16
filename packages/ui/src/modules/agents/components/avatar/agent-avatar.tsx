import "./agent-avatar.css";

import {
  type AvatarCharacter,
  avatarCharacter,
  type AvatarMood,
  avatarSvg,
  emojiSvg,
  parseAvatar,
} from "api-server-api/avatar/svg";
import { useMemo } from "react";
import { match } from "ts-pattern";

import { cn } from "@/lib/utils";

import { getUser } from "../../../../auth.js";
import type { AgentView } from "../../../../types.js";
import type { AgentDisplayState } from "../../utils/agent-resolver.js";

export type AgentAvatarMood = AvatarMood | "disabled";

export function avatarMood(
  state: AgentDisplayState | undefined,
  agent: Pick<AgentView, "stopRequested" | "disabled"> | null | undefined,
): AgentAvatarMood {
  if (agent?.disabled || state === "disabled") return "disabled";
  return agent?.stopRequested ||
    state === "hibernated" ||
    state === "hibernating"
    ? "asleep"
    : "awake";
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
  mood?: AgentAvatarMood;
  playing?: boolean;
  className?: string;
}

export function AgentAvatar({
  name,
  avatar,
  size = 24,
  mood = "awake",
  playing = false,
  className,
}: Props) {
  const owner = getUser()?.profile.sub ?? "";
  const parsed = useMemo(
    () => parseAvatar(avatar ?? undefined, owner, name),
    [avatar, owner, name],
  );
  const svg = useMemo(
    () =>
      match(parsed)
        .with({ kind: "character" }, (p) =>
          avatarSvg(p.character, mood === "awake" ? "awake" : "asleep"),
        )
        .with({ kind: "emoji" }, (p) => emojiSvg(p.emoji))
        .with({ kind: "image" }, () => null)
        .exhaustive(),
    [parsed, mood],
  );
  const props = {
    "data-testid": "agent-avatar",
    "data-character":
      parsed.kind === "character" ? parsed.character : undefined,
    "data-mood": mood,
    "data-playing": playing || undefined,
    "aria-hidden": true,
    className: cn("agent-avatar inline-block shrink-0 select-none", className),
    style: { width: size, height: size },
  };
  return svg === null ? (
    <span {...props}>
      <img
        src={`/api/public/avatars/${parsed.kind === "image" ? parsed.id : ""}`}
        alt=""
        className="size-full rounded-[22%] object-cover"
      />
    </span>
  ) : (
    <span {...props} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
