import { Locked } from "@carbon/icons-react";
import type { SkillRef } from "api-server-api";
import { useCallback, useRef } from "react";

import { SectionLabel } from "@/components/ui/section-label";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { AgentView } from "../../../types.js";
import { SkillsPanel } from "../../sessions/components/skills-panel.js";
import { useOperableState, WakeToEditButton } from "./sandbox-wake-to-edit.js";

/** Interim re-home of the existing skills panel (redesign tracked in #944).
 *  onOpenFile is omitted — the file viewer is a chat-only affordance. */
export function SandboxSkillsSection({ agent }: { agent: AgentView }) {
  // Mirror the panel's installed set into the summary's query cache so the
  // sidebar line stays live, without the summary polling the destructive
  // `skills.state` endpoint (which would clobber an in-flight toggle).
  const seededRef = useRef(false);
  const onInstalledChange = useCallback(
    (installed: SkillRef[]) => {
      // Skip the panel's initial empty state before it has loaded, so we don't
      // blank a summary the one-shot fetch already populated.
      if (installed.length === 0 && !seededRef.current) return;
      seededRef.current = true;
      queryClient.setQueryData(
        trpc.skills.state.queryKey({ agentId: agent.id }),
        (prev) => ({
          installed,
          standalone: prev?.standalone ?? [],
          instancePublishes: prev?.instancePublishes ?? [],
        }),
      );
    },
    [agent.id],
  );

  const { operable, comingUp } = useOperableState(agent.id);

  return (
    <section className="mb-8">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
        {operable ? (
          <SectionLabel>Skills</SectionLabel>
        ) : (
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Locked size={14} /> Skills are read-only while the agent is stopped
          </span>
        )}
        {!operable && (
          <WakeToEditButton agentId={agent.id} comingUp={comingUp} />
        )}
      </div>
      <SkillsPanel
        agentId={agent.id}
        agentState={agent.state}
        readOnly={!operable}
        onInstalledChange={onInstalledChange}
      />
    </section>
  );
}
