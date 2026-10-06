import { useEffect } from "react";

import { unlockAllCharacters } from "../modules/agents/lib/character-unlocks.js";
import { useStore } from "../store.js";

export function MockStateBar() {
  const setView = useStore((s) => s.setView);

  useEffect(() => {
    unlockAllCharacters();
    setView("avatar-sheet");
  }, [setView]);

  return null;
}
