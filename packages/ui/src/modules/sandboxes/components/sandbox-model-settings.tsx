import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import {
  useHarnessConfigStatus,
  useResolvedHarnessConfig,
} from "../../agents/api/harness-config.js";
import { ModelSettingsPanel } from "../../sessions/components/model-settings-panel.js";
import {
  OptionField,
  ReadOnlyOptionFace,
} from "../../sessions/components/option-field.js";
import type { useHarnessConfigDraft } from "../hooks/use-harness-config-draft.js";
import { useOperableState, WakeToEditButton } from "./sandbox-wake-to-edit.js";

export function SandboxModelSettings({
  agentId,
  draft,
}: {
  agentId: string;
  draft: ReturnType<typeof useHarnessConfigDraft>;
}) {
  const { operable, comingUp } = useOperableState(agentId);
  const { data: status, isPending: statusPending } =
    useHarnessConfigStatus(agentId);
  const { origin, hasRun, pending } = useResolvedHarnessConfig(agentId);
  const hasCatalog = !!status?.catalog && status.catalog.options.length > 0;

  if (statusPending || pending) return <ModelSettingsSkeleton />;

  if (!operable && !hasRun) {
    return (
      <Fallback agentId={agentId} comingUp={comingUp}>
        This agent hasn&rsquo;t run yet — its model settings are resolved inside
        the sandbox, so there&rsquo;s nothing recorded to show. Start it once
        and this page fills in.
      </Fallback>
    );
  }

  if (!operable && !hasCatalog) {
    return (
      <Fallback agentId={agentId} comingUp={comingUp}>
        Start the agent to load and edit its model settings.
      </Fallback>
    );
  }

  if (!operable && origin === "none") {
    return (
      <Section agentId={agentId} comingUp={comingUp}>
        {status?.catalog?.options.map((group) => (
          <OptionField key={group.id} title={group.name}>
            <ReadOnlyOptionFace label="Unknown" hint="Start agent to view" />
          </OptionField>
        ))}
      </Section>
    );
  }

  if (operable && !hasCatalog && status?.supported === true) {
    return (
      <Fallback agentId={agentId} comingUp={comingUp}>
        Waiting for the agent to report which model settings it offers.
      </Fallback>
    );
  }

  return (
    <ModelSettingsPanel
      agentId={agentId}
      draft={draft}
      disabled={!operable}
      headerAction={
        operable ? undefined : (
          <WakeToEditButton agentId={agentId} comingUp={comingUp} />
        )
      }
    />
  );
}

function ModelSettingsSkeleton() {
  return (
    <section
      className="mb-8"
      aria-busy="true"
      aria-label="Model settings loading"
    >
      <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
        <SectionLabel>Model settings</SectionLabel>
      </div>
      <Callout inset>
        <div className="animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="mb-4 last:mb-0">
              <SectionLabel className="mb-1.5 block">
                <span className="inline-block h-[0.7em] w-20 rounded bg-muted align-middle" />
              </SectionLabel>
              <div className="h-10 rounded-md border border-input bg-muted/40" />
            </div>
          ))}
        </div>
      </Callout>
    </section>
  );
}

function Section({
  agentId,
  comingUp,
  children,
}: {
  agentId: string;
  comingUp: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
        <SectionLabel>Model settings</SectionLabel>
        <WakeToEditButton agentId={agentId} comingUp={comingUp} />
      </div>
      <Callout inset>{children}</Callout>
    </section>
  );
}

function Fallback({
  agentId,
  comingUp,
  children,
}: {
  agentId: string;
  comingUp: boolean;
  children: React.ReactNode;
}) {
  return (
    <Section agentId={agentId} comingUp={comingUp}>
      <p className="text-sm text-muted-foreground">{children}</p>
    </Section>
  );
}
