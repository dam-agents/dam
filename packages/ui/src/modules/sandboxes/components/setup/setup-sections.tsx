import { type ReactNode, useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { useAppConnections } from "../../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../../connections/hooks/use-catalog-groups.js";
import type { ProviderRef } from "../../../providers/components/provider-item.js";
import { ProviderSelect } from "../../../providers/components/provider-select.js";
import { excludeProviderConnections } from "../../lib/provider-connections.js";
import type { setupProviderPolicy } from "../../lib/setup-policy.js";
import { GrantedConnectionsPanel } from "../granted-connections-panel.js";

export function NameSection({
  value,
  onChange,
  avatar,
  autoFocus = true,
}: {
  value: string;
  onChange: (name: string) => void;
  avatar?: ReactNode;
  autoFocus?: boolean;
}) {
  const field = (
    <FormField
      label="Name"
      disableInset={!!avatar}
      className={avatar ? "min-w-0 flex-1" : undefined}
    >
      <Input
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="my-agent"
      />
    </FormField>
  );
  return (
    <section className="mb-8">
      {avatar ? (
        <div className="flex items-end gap-4 md:-ml-4">
          {avatar}
          {field}
        </div>
      ) : (
        field
      )}
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

export function ConnectionsSetupSection({
  connectionIds,
  onToggle,
  oauthReturnView,
  children,
  excludeIds,
}: {
  connectionIds: string[];
  onToggle: (id: string, granted: boolean) => void;
  oauthReturnView: string;
  children?: React.ReactNode;
  excludeIds?: Set<string>;
}) {
  const connectionsQ = useAppConnections();
  const [catalogOpen, setCatalogOpen] = useState(false);

  const grantedIds = useMemo(() => new Set(connectionIds), [connectionIds]);
  const staged = useMemo(
    () =>
      excludeProviderConnections(connectionsQ.data ?? []).filter(
        (c) => grantedIds.has(c.id) && !excludeIds?.has(c.id),
      ),
    [connectionsQ.data, grantedIds, excludeIds],
  );
  const { populated: groups, templateById } = useCatalogGroups(staged);

  return (
    <section className="mb-8">
      <GrantedConnectionsPanel
        groups={groups}
        templateById={templateById}
        onToggleGrant={onToggle}
        onOpenCatalog={() => setCatalogOpen(true)}
        sectionLabel={
          <>
            Connections{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </>
        }
      >
        {children}
      </GrantedConnectionsPanel>
      {catalogOpen && (
        <ConnectionCatalogModal
          onClose={() => setCatalogOpen(false)}
          sandbox={{ grantedIds, onToggleGrant: onToggle }}
          oauthReturnView={oauthReturnView}
        />
      )}
    </section>
  );
}
