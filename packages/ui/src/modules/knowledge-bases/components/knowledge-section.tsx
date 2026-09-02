import { useEffect, useRef } from "react";

import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { isKnowledgeBase } from "../../agents/utils/agent-kind.js";
import { ConnectedKnowledgeBases } from "./connected-knowledge-bases.js";
import { KbSharingSection } from "./kb-sharing-section.js";

export function KnowledgeSection({ agent }: { agent: AgentView }) {
  const shareable = isKnowledgeBase(agent);
  const focus = useStore((s) => s.sandboxFocus);
  const clearSandboxFocus = useStore((s) => s.clearSandboxFocus);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focus === "knowledge" && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
      clearSandboxFocus();
    }
  }, [focus, clearSandboxFocus]);

  return (
    <section ref={ref} className="mb-8">
      <SectionLabel spaced>Knowledge</SectionLabel>
      <div className="flex flex-col gap-6">
        {shareable && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium text-foreground">
              Share this knowledge base
            </h4>
            <KbSharingSection key={agent.id} agentId={agent.id} />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-foreground">
            Connected knowledge bases
          </h4>
          <ConnectedKnowledgeBases key={agent.id} agentId={agent.id} />
        </div>
      </div>
    </section>
  );
}
