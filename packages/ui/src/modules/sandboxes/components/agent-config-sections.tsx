import { SectionLabel } from "@/components/ui/section-label";

export function AgentModelSettingsSection({ agentId }: { agentId: string }) {
  return (
    <section
      className="flex flex-col gap-4 py-4"
      data-testid={`agent-model-settings-${agentId}`}
    >
      <SectionLabel>Model</SectionLabel>
      <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Claude Sonnet 4
          </span>
          <span className="text-xs text-muted-foreground">
            Balanced speed and quality
          </span>
        </div>
        <span className="text-xs text-muted-foreground">Default</span>
      </div>
    </section>
  );
}
