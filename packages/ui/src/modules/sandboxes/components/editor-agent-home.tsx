import { PageHeader } from "@/components/ui/page-header";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../agents/components/avatar/agent-avatar.js";
import { SharedBadge } from "../../agents/components/shared-badge.js";
import { ownerLine, peopleSummary } from "../../agents/lib/agent-editors.js";
import type { SandboxSection } from "../../platform/lib/routes.js";
import { PeopleSection } from "./people-section.js";
import { SandboxSectionNav, SECTIONS } from "./sandbox-section-nav.js";

const EDITOR_SECTIONS: ReadonlySet<SandboxSection> = new Set([
  "setup",
  "people",
]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: A Shared Agent's page as one of its Agent
 * Editors sees it. It says whose agent it is and who else works on it, and
 * offers none of the owner's controls: an editor views the agent and does
 * not change it yet. The other sections read the owner's own data, so they
 * stay hidden here rather than fail one by one.
 */
export function EditorAgentHome({ agent }: { agent: AgentView }) {
  const section = useStore((s) => s.sandboxSection);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const shown: SandboxSection = EDITOR_SECTIONS.has(section)
    ? section
    : "setup";
  const sections = SECTIONS.filter((e) => EDITOR_SECTIONS.has(e.section));
  const entry = SECTIONS.find((e) => e.section === shown);
  const Pictogram = entry?.pictogram;
  const ownerEmail =
    agent.access.role === "editor" ? agent.access.ownerEmail : null;

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-10 md:pt-5">
      <SandboxSectionNav
        sections={sections}
        header={<EditorIdentity agent={agent} ownerEmail={ownerEmail} />}
        active={shown}
        onNavigate={(s) => navigateToSandboxHome(agent.id, s)}
        summaries={{ setup: "View only", people: peopleSummary(agent.access) }}
      />
      <div className="min-w-0 flex-1 md:max-w-[760px]">
        <PageHeader
          title={entry?.title ?? ""}
          description={entry?.description}
          pictogram={Pictogram && <Pictogram aria-hidden />}
        />
        {shown === "people" ? (
          <PeopleSection agent={agent} />
        ) : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="agent-editor-notice"
          >
            {ownerEmail ?? "Its owner"} shared this agent with you as an editor.
            You can see who works on it; changing its set-up comes next.
          </p>
        )}
      </div>
    </div>
  );
}

function EditorIdentity({
  agent,
  ownerEmail,
}: {
  agent: AgentView;
  ownerEmail: string | null;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 px-3">
      <div className="flex min-w-0 items-center gap-3">
        <AgentAvatar
          name={agent.name}
          avatar={agent.avatar}
          size={36}
          mood={avatarMood(agent.state, agent)}
          className="shrink-0"
        />
        <h2 className="flex min-w-0 text-lg font-semibold text-foreground">
          <span className="truncate">{agent.name}</span>
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SharedBadge />
      </div>
      <p
        className="text-xs text-muted-foreground"
        data-testid="agent-owner-line"
      >
        {ownerLine(ownerEmail)}
      </p>
    </div>
  );
}
