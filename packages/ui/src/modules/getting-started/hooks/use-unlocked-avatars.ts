import type { AvatarCharacter } from "api-server-api/avatar/svg";

import { useGettingStarted } from "../api/queries.js";

export function useUnlockedAvatars(): readonly AvatarCharacter[] | null {
  const progress = useGettingStarted().data;
  return progress ? progress.unlocks.map((u) => u.character) : null;
}

export function useFreshAvatars(): readonly AvatarCharacter[] {
  const progress = useGettingStarted().data;
  return progress
    ? progress.unlocks.filter((u) => u.fresh).map((u) => u.character)
    : [];
}
