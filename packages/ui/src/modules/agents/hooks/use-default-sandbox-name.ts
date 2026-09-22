import { useEffect, useMemo, useRef } from "react";

import { useAgents } from "../api/queries.js";
import { nextSandboxName } from "../lib/sandbox-name.js";

function useDefaultSandboxName(prefix: string): string {
  const { data } = useAgents();
  return useMemo(
    () =>
      nextSandboxName(
        prefix,
        (data?.list ?? []).map((a) => a.name),
      ),
    [data, prefix],
  );
}

export function usePrefilledSandboxName(
  prefix: string,
  name: string,
  setName: (name: string) => void,
): void {
  const suggestion = useDefaultSandboxName(prefix);
  const suggested = useRef<string | null>(null);
  useEffect(() => {
    const stillOurs =
      suggested.current === null
        ? name.trim().length === 0
        : name === suggested.current;
    if (!stillOurs || name === suggestion) return;
    suggested.current = suggestion;
    setName(suggestion);
  }, [suggestion, name, setName]);
}
