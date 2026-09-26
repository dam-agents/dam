import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useIsAgentInaccessible } from "../../agents/api/queries.js";
import { usePublicAgentFallback } from "../../agents/hooks/use-public-agent-fallback.js";
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
import { StickyFooterLayout } from "../components/sticky-footer-layout.js";
import { useSandboxSettingsForm } from "../hooks/use-sandbox-settings-form.js";
import { useSectionSummaries } from "../hooks/use-section-summaries.js";

export function SandboxHomeView() {
  const f = useSandboxSettingsForm();
  const agentId = useStore((s) => s.agentId);
  const section = useStore((s) => s.sandboxSection);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const agentInaccessible = useIsAgentInaccessible(agentId);
  usePublicAgentFallback(agentId, agentInaccessible);

  const display = useResolvedAgentDisplay(f.agent);

  const { summaries, warnings } = useSectionSummaries(f.agent);

  if (f.status !== "ready" || !f.agent || !display) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 pt-10 md:px-8">
        {f.status === "no-agent" && (
          <p className="text-sm text-muted-foreground">No agent selected.</p>
        )}
        {f.status === "not-found" && (
          <p className="text-sm text-muted-foreground">Agent not found.</p>
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
    <StickyFooterLayout
      footer={section === "setup" || f.dirty ? footer : undefined}
      footerClassName="max-w-[1040px]"
    >
      <div className="mx-auto w-full max-w-[1040px] px-4 pt-6 pb-8 md:px-8 md:pt-12">
        <div className="flex flex-col gap-6 md:flex-row md:gap-10">
          <SandboxSectionNav
            active={section}
            onNavigate={(s) => navigateToSandboxHome(agent.id, s)}
            summaries={summaries}
            warnings={warnings}
          />
          <div className="min-w-0 flex-1 md:max-w-[760px]">
            <SandboxHomeHeader
              agent={agent}
              display={display}
              avatarName={f.draftName?.trim() || agent.name}
            />
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
              <SandboxUsageSection agentId={agent.id} />
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
          </div>
        </div>
      </div>
    </StickyFooterLayout>
  );
}
