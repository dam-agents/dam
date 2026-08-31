import { useEffect, useMemo, useRef } from "react";

import type { AgentView } from "../../../types.js";
import { useAgents } from "../api/queries.js";
import { nextSandboxName, type SandboxNameKind } from "../lib/sandbox-name.js";
import {
  isCodingAgent,
  isExperimentSandbox,
  isKnowledgeBase,
} from "../utils/agent-kind.js";

const MATCHES_KIND: Record<SandboxNameKind, (a: AgentView) => boolean> = {
  "coding-agent": isCodingAgent,
  experiment: isExperimentSandbox,
  "knowledge-base": isKnowledgeBase,
  research: isExperimentSandbox,
  assistant: isCodingAgent,
};

function useDefaultSandboxName(kind: SandboxNameKind): string {
  const { data } = useAgents();
  return useMemo(() => {
    const taken = (data?.list ?? [])
      .filter(MATCHES_KIND[kind])
      .map((a) => a.name);
    return nextSandboxName(kind, taken);
  }, [data, kind]);
}

export function usePrefilledSandboxName(
  kind: SandboxNameKind,
  name: string,
  setName: (name: string) => void,
): void {
  const suggestion = useDefaultSandboxName(kind);
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
