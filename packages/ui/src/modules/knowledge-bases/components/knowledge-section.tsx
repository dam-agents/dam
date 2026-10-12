import { SectionLabel } from "@/components/ui/section-label";

import type { AgentView } from "../../../types.js";
import { sharesKnowledgeBase } from "../../agents/utils/agent-kind.js";
import { ConnectedKnowledgeBases } from "./connected-knowledge-bases.js";
import { KbSharingSection } from "./kb-sharing-section.js";

export function KnowledgeSection({ agent }: { agent: AgentView }) {
  return (
    <>
      {sharesKnowledgeBase(agent) && (
        <section className="mb-8">
          <SectionLabel spaced>Share this knowledge base</SectionLabel>
          <KbSharingSection key={agent.id} agentId={agent.id} />
        </section>
      )}
      <ConnectedKnowledgeBases
        key={agent.id}
        agentId={agent.id}
        label={
          sharesKnowledgeBase(agent) ? "Connected knowledge bases" : undefined
        }
      />
    </>
  );
}
