import { useEffect, useMemo, useRef } from "react";

import { useAgents } from "../api/queries.js";
import {
  nextSandboxName,
  sandboxNameBase,
  type SandboxNameKind,
} from "../lib/sandbox-name.js";

function useDefaultSandboxName(
  kind: SandboxNameKind,
  kitName?: string | null,
): string {
  const { data } = useAgents();
  return useMemo(() => {
    const taken = (data?.list ?? []).map((a) => a.name);
    return nextSandboxName(sandboxNameBase(kind, kitName), taken);
  }, [data, kind, kitName]);
}

export function usePrefilledSandboxName(
  kind: SandboxNameKind,
  name: string,
  setName: (name: string) => void,
  kitName?: string | null,
): void {
  const suggestion = useDefaultSandboxName(kind, kitName);
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
