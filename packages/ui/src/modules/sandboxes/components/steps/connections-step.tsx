import { useMemo, useState } from "react";

import { useAppConnections } from "../../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../../connections/hooks/use-catalog-groups.js";
import { excludeProviderConnections } from "../../lib/provider-connections.js";
import type { WizardSnapshot } from "../../lib/wizard-snapshot.js";
import { GrantedConnectionsPanel } from "../granted-connections-panel.js";
import { StepHeader } from "../step-header.js";

interface Props {
  snapshot: WizardSnapshot;
  update: (patch: Partial<WizardSnapshot>) => void;
}

/** Grants stage into the wizard draft — the sandbox doesn't exist yet, the
 *  create call applies them. */
export function ConnectionsStep({ snapshot, update }: Props) {
  const connectionsQ = useAppConnections();
  const [catalogOpen, setCatalogOpen] = useState(false);

  const grantedIds = useMemo(
    () => new Set(snapshot.connectionIds),
    [snapshot.connectionIds],
  );
  const toggle = (id: string, on: boolean) =>
    update({
      connectionIds: on
        ? [...new Set([...snapshot.connectionIds, id])]
        : snapshot.connectionIds.filter((x) => x !== id),
    });

  const staged = useMemo(
    () =>
      excludeProviderConnections(connectionsQ.data ?? []).filter((c) =>
        grantedIds.has(c.id),
      ),
    [connectionsQ.data, grantedIds],
  );
  const { populated: groups, templateById } = useCatalogGroups(staged);

  return (
    <div>
      <StepHeader
        step={3}
        title="Grant connections"
        subtitle="Choose which app connections and credentials this sandbox can access."
      />
      <GrantedConnectionsPanel
        groups={groups}
        templateById={templateById}
        onToggleGrant={toggle}
        onOpenCatalog={() => setCatalogOpen(true)}
      />
      {catalogOpen && (
        <ConnectionCatalogModal
          onClose={() => setCatalogOpen(false)}
          sandbox={{ grantedIds, onToggleGrant: toggle }}
          oauthReturnView="/sandboxes/new"
        />
      )}
    </div>
  );
}
