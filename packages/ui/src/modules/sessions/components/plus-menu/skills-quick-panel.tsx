import { Add } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { useAgent } from "../../../agents/api/queries.js";
import { useOperableState } from "../../../agents/hooks/use-operable-state.js";
import { holds } from "../../../agents/lib/agent-permissions.js";
import type { SkillsModal } from "../../../sandboxes/components/skills/skills-modals.js";
import { SkillsSurface } from "../../../sandboxes/components/skills/skills-surface.js";
import { DescribeButton, PlusMenuPanelFrame } from "./plus-menu-panel.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Skills panel of the composer's + menu, as the
 * design draws it: the Agent's own skills surface in its compact form — the
 * search, the counts, the skills created in the Agent, and a card per GitHub
 * source with its switches — and a footer to add a source or describe one.
 * Switches are off limits while the Agent cannot take a change. A viewer who
 * may not change its skills gets the design's read-only state: the names
 * alone, no footer and no Manage.
 */
export function SkillsQuickPanel({
  agentId,
  onBack,
  onManage,
  onAddSource,
  onDescribe,
  onOpenModal,
}: {
  agentId: string;
  onBack: () => void;
  onManage?: () => void;
  onAddSource: () => void;
  onDescribe: () => void;
  onOpenModal: (modal: SkillsModal) => void;
}) {
  const agent = useAgent(agentId);
  const { operable, comingUp } = useOperableState(agentId);
  const changes = !!agent && holds(agent.access, "skills");
  const addsSources = !!agent && holds(agent.access, "skillSources");

  return (
    <PlusMenuPanelFrame
      title="Skills"
      onBack={onBack}
      onManage={changes ? onManage : undefined}
      footer={
        changes && (
          <>
            {addsSources ? (
              <Button variant="outline" size="sm" onClick={onAddSource}>
                <Add size={16} /> Add source
              </Button>
            ) : (
              <span />
            )}
            <DescribeButton onClick={onDescribe} />
          </>
        )
      }
    >
      <SkillsSurface
        agentId={agentId}
        agentState={agent?.state}
        readOnly={!operable}
        comingUp={comingUp}
        managesLibrary={addsSources}
        canPublish={false}
        compact
        hideSwitches={!!agent && !changes}
        onOpenModal={onOpenModal}
      />
    </PlusMenuPanelFrame>
  );
}
