import { useMemo } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useSyncRestartingAgents } from "../../agents/hooks/use-restart-agent.js";
import { resolveAgentDisplay } from "../../agents/utils/agent-resolver.js";
import { ConnectionsSection } from "../components/connections-section.js";
import { SandboxHomeHeader } from "../components/sandbox-home-header.js";
import { SandboxSchedulesSection } from "../components/sandbox-schedules-section.js";
import { SandboxSectionNav } from "../components/sandbox-section-nav.js";
import { SandboxSetupSection } from "../components/sandbox-setup-section.js";
import { SandboxSkillsSection } from "../components/sandbox-skills-section.js";
import { SandboxTwoColumnShell } from "../components/sandbox-two-column-shell.js";
import { useSandboxSettingsForm } from "../hooks/use-sandbox-settings-form.js";
import { useSectionSummaries } from "../hooks/use-section-summaries.js";

export function SandboxHomeView() {
  const f = useSandboxSettingsForm();
  const section = useStore((s) => s.sandboxSection);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const restartingAgents = useStore((s) => s.restartingAgents);
  useSyncRestartingAgents();
  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );

  const summaries = useSectionSummaries(f.agent);

  if (f.status !== "ready" || !f.agent) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 pt-10 md:px-8">
        {f.status === "no-agent" && (
          <p className="text-[13px] text-muted-foreground">
            No sandbox selected.
          </p>
        )}
        {f.status === "not-found" && (
          <p className="text-[13px] text-muted-foreground">
            Sandbox not found.
          </p>
        )}
      </div>
    );
  }

  const { agent } = f;
  const display = resolveAgentDisplay(agent, restartingIds);

  const footer = (
    <>
      {f.wildcardHostInScope && (
        <span
          role="alert"
          className="mr-auto inline-flex items-center gap-1.5 text-[12px] text-warning"
          title="A wildcard host '*' rule is in scope. Any unmatched egress is allowed."
        >
          <span aria-hidden="true">⚠</span>
          Allow everything is on — narrow with deny rules or remove the
          wildcard.
        </span>
      )}
      <Button onClick={f.onSave} disabled={f.isSubmitDisabled}>
        {f.saving ? "Saving…" : "Submit changes"}
      </Button>
    </>
  );

  return (
    <SandboxTwoColumnShell
      footer={f.dirty ? footer : undefined}
      nav={
        <SandboxSectionNav
          active={section}
          onNavigate={(s) => navigateToSandboxHome(agent.id, s)}
          summaries={summaries}
        />
      }
    >
      <SandboxHomeHeader agent={agent} display={display} />
      {section === "setup" ? (
        <SandboxSetupSection f={f} />
      ) : section === "skills" ? (
        <SandboxSkillsSection agent={agent} />
      ) : section === "schedules" ? (
        <SandboxSchedulesSection agentId={agent.id} />
      ) : (
        <ConnectionsSection
          grantedIds={f.grantedAppIds}
          onToggleGrant={f.toggleAppGrant}
          oauthReturnView={`/sandboxes/${agent.id}/connections`}
        />
      )}
    </SandboxTwoColumnShell>
  );
}
