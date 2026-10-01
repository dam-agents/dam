import { type ReactNode, useCallback, useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { HintTooltip } from "@/components/ui/tooltip";

import { AgentAvatar } from "../../../agents/components/avatar/agent-avatar.js";
import { useAgentAvatars } from "../../../agents/hooks/use-agent-avatars.js";
import type { SizeMi } from "../../../budgets/lib/slots.js";
import { useAppConnections } from "../../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../../connections/hooks/use-catalog-groups.js";
import type { ProviderRef } from "../../../providers/components/provider-item.js";
import { ProviderSelect } from "../../../providers/components/provider-select.js";
import {
  NO_SATELLITES,
  useSatellites,
} from "../../../satellites/api/queries.js";
import { SatellitesGroupCard } from "../../../satellites/components/satellites-group-card.js";
import { excludeProviderConnections } from "../../lib/provider-connections.js";
import type { setupProviderPolicy } from "../../lib/setup-policy.js";
import { GrantedConnectionsPanel } from "../granted-connections-panel.js";
import { DEFAULT_HIBERNATE_MIN, LifecycleField } from "../lifecycle-field.js";

export function NameSection({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const avatars = useAgentAvatars();
  return (
    <section className="mb-8">
      <FormField label="Name">
        <div className="flex items-center gap-3">
          <Input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="my-agent"
          />
          {avatars && (
            <HintTooltip
              label="Agent avatar"
              content="Agent avatar is generated from its name and can't currently be changed manually."
            >
              <AgentAvatar name={value} size={40} />
            </HintTooltip>
          )}
        </div>
      </FormField>
    </section>
  );
}

export function ProviderSection({
  selected,
  onSelect,
  policy,
}: {
  selected: ProviderRef | null;
  onSelect: (ref: ProviderRef | null) => void;
  policy: ReturnType<typeof setupProviderPolicy>;
}) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Provider</SectionLabel>
      <Inset>
        <ProviderSelect
          selected={selected}
          onSelect={onSelect}
          autoSelectFirst
          required
          allow={policy.allow}
          recommended={policy.recommended}
        />
      </Inset>
    </section>
  );
}

export function useSetupConnectionCatalog({
  connectionIds,
  onToggle,
  satelliteNames,
  onToggleSatellite,
  oauthReturnView,
}: {
  connectionIds: string[];
  onToggle: (id: string, granted: boolean) => void;
  satelliteNames: string[];
  onToggleSatellite: (name: string, granted: boolean) => void;
  oauthReturnView: string;
}): { openCatalog: () => void; catalogNode: ReactNode } {
  const [open, setOpen] = useState(false);
  const grantedIds = useMemo(() => new Set(connectionIds), [connectionIds]);
  const openCatalog = useCallback(() => setOpen(true), []);
  return {
    openCatalog,
    catalogNode: open ? (
      <ConnectionCatalogModal
        onClose={() => setOpen(false)}
        sandbox={{ grantedIds, onToggleGrant: onToggle }}
        satelliteGrant={(s) => ({
          granted: satelliteNames.includes(s.name),
          onToggle: (on) => onToggleSatellite(s.name, on),
        })}
        oauthReturnView={oauthReturnView}
      />
    ) : null,
  };
}

export function ConnectionsSetupSection({
  connectionIds,
  onToggle,
  satelliteNames,
  onToggleSatellite,
  onOpenCatalog,
  leading,
  excludeIds,
}: {
  connectionIds: string[];
  onToggle: (id: string, granted: boolean) => void;
  satelliteNames: string[];
  onToggleSatellite: (name: string, granted: boolean) => void;
  onOpenCatalog: () => void;
  leading?: React.ReactNode;
  excludeIds: ReadonlySet<string>;
}) {
  const connectionsQ = useAppConnections();
  const { data: satellites = NO_SATELLITES } = useSatellites();
  const pickedSatellites = useMemo(
    () => satellites.filter((s) => satelliteNames.includes(s.name)),
    [satellites, satelliteNames],
  );
  const grantedIds = useMemo(() => new Set(connectionIds), [connectionIds]);
  const granted = useMemo(
    () => (connectionsQ.data ?? []).filter((c) => grantedIds.has(c.id)),
    [connectionsQ.data, grantedIds],
  );
  const staged = useMemo(
    () =>
      excludeProviderConnections(granted).filter((c) => !excludeIds.has(c.id)),
    [granted, excludeIds],
  );
  const { populated: groups, templateById } = useCatalogGroups(staged);
  const satellitesCard = pickedSatellites.length > 0 && (
    <SatellitesGroupCard
      satellites={pickedSatellites}
      showCount
      grant={(s) => ({
        granted: true,
        onToggle: (on) => onToggleSatellite(s.name, on),
        actionHidden: true,
      })}
    />
  );

  return (
    <section className="mb-8">
      <GrantedConnectionsPanel
        groups={groups}
        granted={granted}
        templateById={templateById}
        onToggleGrant={onToggle}
        onOpenCatalog={onOpenCatalog}
        title="Connections"
        {...(leading || satellitesCard
          ? {
              leading: (
                <>
                  {leading}
                  {satellitesCard}
                </>
              ),
            }
          : {})}
      />
    </section>
  );
}

export function LifecycleSetupSection({
  value,
  onChange,
  sizeMi,
}: {
  value: number | null;
  onChange: (next: number) => void;
  sizeMi?: SizeMi;
}) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Lifecycle</SectionLabel>
      <Inset>
        <LifecycleField
          value={value ?? DEFAULT_HIBERNATE_MIN}
          onChange={onChange}
          sizeMi={sizeMi}
        />
      </Inset>
    </section>
  );
}

export function ConnectionAddressingSetupSection({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Credential injection</SectionLabel>
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-medium text-foreground">
            Inject only into addressed requests
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Credentials go only into requests that name a connection; others are
            sent as-is. For agents whose tools (Docker containers, nested
            agents) call the same services with their own credentials or none.
          </span>
        </span>
        <Switch
          checked={value}
          onCheckedChange={onChange}
          disabled={disabled}
          label="Inject only into addressed requests"
        />
      </label>
    </section>
  );
}
