import {
  type AvatarCharacter,
  leastUsedCharacter,
} from "api-server-api/avatar/svg";

import type { AgentView } from "../../../types.js";
import { resolveCharacter } from "../components/avatar/agent-avatar.js";

export function defaultAvatar(
  name: string,
  unlocked: readonly AvatarCharacter[] | null,
  agents: readonly Pick<AgentView, "name" | "avatar">[],
): AvatarCharacter {
  if (unlocked?.length === 0) return resolveCharacter(name, null);
  return leastUsedCharacter(
    agents.map((a) => resolveCharacter(a.name, a.avatar)),
    unlocked ?? undefined,
  );
}
