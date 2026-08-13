import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import {
  useHarnessConfigStatus,
  useResolvedHarnessConfig,
} from "../../agents/api/harness-config.js";
import { ModelSettingsPanel } from "../../sessions/components/model-settings-panel.js";
import type { useHarnessConfigDraft } from "../hooks/use-harness-config-draft.js";
import { useOperableState, WakeToEditButton } from "./sandbox-wake-to-edit.js";

/**
 * Sandbox-home Model Settings: the shared panel in its page variant, gated by
 * the agent's lifecycle. Editable only while operable; asleep it shows the last
 * recorded values read-only with a "Start agent to edit" action, and a spinner
 * while the agent is coming up.
 */
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

  // First: every branch below reads what these two queries carry.
  if (statusPending || pending) return <ModelSettingsSkeleton />;

  // Nothing recorded and no pod to ask. Told apart from the case below because
  // "never run" is a complete explanation, while a sandbox that has run and
  // still shows nothing is a gap the user can close by starting it.
  if (!operable && !hasRun) {
    return (
      <Fallback agentId={agentId} comingUp={comingUp}>
        This sandbox hasn&rsquo;t run yet — its model settings are resolved
        inside the sandbox, so there&rsquo;s nothing recorded to show. Start it
        once and this page fills in.
      </Fallback>
    );
  }

  // Has run, but there's nothing renderable: no catalog arrived, or no values
  // were ever recorded. A panel of "Not set" pickers would be a claim about the
  // harness's config that we can't actually make.
  if (!operable && (!hasCatalog || origin === "none")) {
    return (
      <Fallback agentId={agentId} comingUp={comingUp}>
        Start the agent to load and edit its model settings.
      </Fallback>
    );
  }

  // `supported` is optimistic while capabilities are unknown, so this wait is
  // unbounded — name it rather than shimmer forever.
  if (operable && !hasCatalog && status?.supported === true) {
    return (
      <Fallback agentId={agentId} comingUp={comingUp}>
        Waiting for the sandbox to report which model settings it offers.
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

/** Shaped like `OptionGroup`'s page variant so the box doesn't reflow. */
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

/** The section with its wake affordance but no pickers — the panel renders
 *  nothing without a catalog, which would hide the way to fix that. */
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
    <section className="mb-8">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
        <SectionLabel>Model settings</SectionLabel>
        <WakeToEditButton agentId={agentId} comingUp={comingUp} />
      </div>
      <Callout inset>
        <p className="text-sm text-muted-foreground">{children}</p>
      </Callout>
    </section>
  );
}
