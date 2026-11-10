import { Add } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { ToggleRow } from "@/components/ui/toggle-row";

import { useAgent } from "../../../agents/api/queries.js";
import { useOperableState } from "../../../agents/hooks/use-operable-state.js";
import { holds } from "../../../agents/lib/agent-permissions.js";
import { useSkillsDerivations } from "../../../sandboxes/hooks/use-skills-derivations.js";
import { useSkillsSurface } from "../../../sandboxes/hooks/use-skills-surface.js";
import {
  DescribeButton,
  PlusMenuGroup,
  PlusMenuNote,
  PlusMenuPanelFrame,
} from "./plus-menu-panel.js";
import { QuickSkillRow } from "./quick-skill-row.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Skills panel of the composer's + menu: the
 * skills of every source the Agent is connected to, each with the switch that
 * installs or removes it on the Agent, and the skills that are always on
 * because they were made in the Agent or came with its image. Switches are off
 * limits while the Agent cannot take a change or the viewer may not change its
 * skills.
 */
export function SkillsQuickPanel({
  agentId,
  onBack,
  onManage,
  onAddSource,
  onDescribe,
}: {
  agentId: string;
  onBack: () => void;
  onManage?: () => void;
  onAddSource: () => void;
  onDescribe: () => void;
}) {
  const agent = useAgent(agentId);
  const { operable } = useOperableState(agentId);
  const changes = !!agent && holds(agent.access, "skills");
  const readOnly = !operable || !changes;
  const surface = useSkillsSurface(agentId, {
    readOnly,
    isError: agent?.state === "error",
  });
  const derived = useSkillsDerivations(surface, { readOnly, query: "" });
  const loading = !surface.sourcesLoaded || !surface.stateLoaded;
  const empty =
    !loading &&
    derived.shownSources.length === 0 &&
    derived.shownCreatedHere.length === 0 &&
    derived.shownBuiltIn.length === 0;
  const addsSources = !!agent && holds(agent.access, "skillSources");

  return (
    <PlusMenuPanelFrame
      title="Skills"
      onBack={onBack}
      onManage={onManage}
      footer={
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
      }
    >
      {loading && <PlusMenuNote>Loading skills…</PlusMenuNote>}
      {empty && <PlusMenuNote>No skills yet.</PlusMenuNote>}
      {!operable && changes && !loading && (
        <PlusMenuNote>Start the agent to turn skills on or off.</PlusMenuNote>
      )}
      {derived.shownCreatedHere.length > 0 && (
        <PlusMenuGroup label="Created in this agent">
          {derived.shownCreatedHere.map((skill) => (
            <ToggleRow key={skill.name} title={skill.name} control={null} />
          ))}
        </PlusMenuGroup>
      )}
      {derived.shownSources.map((source) => (
        <PlusMenuGroup key={source.id} label={source.name}>
          {surface.loadingBySource[source.id] && (
            <PlusMenuNote>Reading this source…</PlusMenuNote>
          )}
          {surface.errorBySource[source.id] && (
            <PlusMenuNote>Couldn't read this source.</PlusMenuNote>
          )}
          {(derived.listBySource.get(source.id) ?? []).map((skill) => (
            <QuickSkillRow
              key={skill.name}
              skill={skill}
              surface={surface}
              readOnly={readOnly}
            />
          ))}
        </PlusMenuGroup>
      ))}
      {derived.shownBuiltIn.length > 0 && (
        <PlusMenuGroup label="Included with sandbox image">
          {derived.shownBuiltIn.map((skill) => (
            <ToggleRow key={skill.name} title={skill.name} control={null} />
          ))}
        </PlusMenuGroup>
      )}
    </PlusMenuPanelFrame>
  );
}
