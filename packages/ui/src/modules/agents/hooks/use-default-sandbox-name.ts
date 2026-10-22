import { useCallback, useEffect, useMemo, useRef } from "react";

import { useAgents } from "../api/queries.js";
import { nextSandboxName } from "../lib/sandbox-name.js";

type SuggestName = (
  takenNames: readonly string[],
  previous: string | null,
) => string;

function usePrefilledName(
  suggest: SuggestName,
  name: string,
  setName: (name: string) => void,
): void {
  const { data } = useAgents();
  const takenNames = useMemo(
    () => (data?.list ?? []).map((a) => a.name),
    [data],
  );
  const suggested = useRef<string | null>(null);
  useEffect(() => {
    const stillOurs =
      suggested.current === null
        ? name.trim().length === 0
        : name === suggested.current;
    if (!stillOurs) return;
    const suggestion = suggest(takenNames, suggested.current);
    if (name === suggestion) return;
    suggested.current = suggestion;
    setName(suggestion);
  }, [suggest, takenNames, name, setName]);
}

export function usePrefilledSandboxName(
  prefix: string,
  name: string,
  setName: (name: string) => void,
): void {
  const suggest = useCallback(
    (takenNames: readonly string[]) => nextSandboxName(prefix, takenNames),
    [prefix],
  );
  usePrefilledName(suggest, name, setName);
}
