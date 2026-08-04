import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useResolvedAgentDisplay } from "../../agents/hooks/use-resolved-agent-display.js";
import { SandboxArtifactsSection } from "../../artifacts/components/sandbox-artifacts-section.js";
import { SandboxUsageSection } from "../../metrics/components/sandbox-usage-section.js";
import { routeToPath } from "../../platform/lib/routes.js";
import { ConnectionsSection } from "../components/connections-section.js";
import { SandboxChannelsSection } from "../components/sandbox-channels-section.js";
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

  const display = useResolvedAgentDisplay(f.agent);

  const summaries = useSectionSummaries(f.agent);

  if (f.status !== "ready" || !f.agent || !display) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 pt-10 md:px-8">
        {f.status === "no-agent" && (
          <p className="text-sm text-muted-foreground">No sandbox selected.</p>
        )}
        {f.status === "not-found" && (
          <p className="text-sm text-muted-foreground">Sandbox not found.</p>
        )}
      </div>
    );
  }

  const { agent } = f;

  const footer = (
    <>
      {f.wildcardHostInScope && (
        <span
          role="alert"
          className="mr-auto inline-flex items-center gap-1.5 text-xs text-warning"
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
      ) : section === "channels" ? (
        <SandboxChannelsSection agentId={agent.id} />
      ) : section === "skills" ? (
        <SandboxSkillsSection agent={agent} />
      ) : section === "schedules" ? (
        <SandboxSchedulesSection agentId={agent.id} />
      ) : section === "artifacts" ? (
        <SandboxArtifactsSection agentId={agent.id} />
      ) : section === "usage" ? (
        // Keyed per sandbox: the spend query keeps the previous month's rows to
        // smooth paging, and the agents list is cached so switching sandboxes
        // never unmounts this — an unkeyed section would serve the previous
        // sandbox's figures under this one's name.
        <SandboxUsageSection key={agent.id} agentId={agent.id} />
      ) : (
        <ConnectionsSection
          agentId={agent.id}
          oauthReturnView={routeToPath({
            view: "sandbox-home",
            agentId: agent.id,
            sandboxSection: "connections",
          })}
          inset
        />
      )}
    </SandboxTwoColumnShell>
  );
}
