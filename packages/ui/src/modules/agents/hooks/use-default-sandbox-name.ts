import { useEffect, useMemo, useRef } from "react";

import {
  nextSandboxName,
  type SandboxNameKind,
} from "../../sandboxes/lib/sandbox-name.js";
import { useAgents } from "../api/queries.js";
import {
  isCodingAgent,
  isExperimentSandbox,
  isKnowledgeBase,
} from "../utils/agent-kind.js";

const MATCHES_KIND = {
  "coding-agent": isCodingAgent,
  experiment: isExperimentSandbox,
  "knowledge-base": isKnowledgeBase,
} as const;

export function useDefaultSandboxName(kind: SandboxNameKind): string | null {
  const { data } = useAgents();
  return useMemo(() => {
    if (!data) return null;
    const taken = data.list.filter(MATCHES_KIND[kind]).map((a) => a.name);
    return nextSandboxName(kind, taken);
  }, [data, kind]);
}

export function usePrefilledSandboxName(
  kind: SandboxNameKind,
  name: string,
  setName: (name: string) => void,
): void {
  const suggestion = useDefaultSandboxName(kind);
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || suggestion === null) return;
    prefilled.current = true;
    if (name.length === 0) setName(suggestion);
  }, [suggestion, name, setName]);
}
