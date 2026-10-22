import type { ChangeSet } from "agent-runtime-api";
import { useState } from "react";

import {
  type ChangeSetSelection,
  choose,
  initialSelection,
} from "../lib/selection.js";

export function useChangeSetSelection(
  changeSets: readonly ChangeSet[] | undefined,
) {
  const [selection, setSelection] = useState<ChangeSetSelection | null>(null);
  if (selection === null && changeSets !== undefined)
    setSelection(initialSelection(changeSets));
  const select = (path: string | null) =>
    setSelection((current) =>
      choose(current ?? { path: null, seen: {} }, changeSets ?? [], path),
    );
  return { selection, select };
}
