import { useMemo, useState } from "react";

import { useAppConnections } from "../../../connections/api/queries.js";
import { ConnectionCatalogModal } from "../../../connections/components/connection-catalog-modal.js";
import { useCatalogGroups } from "../../../connections/hooks/use-catalog-groups.js";
import { useDisconnectConnection } from "../../../connections/hooks/use-disconnect-connection.js";
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
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
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

  // Deleting a staged connection must also drop it from the draft — a stale
  // id would fail the create call (#2426).
  const disconnect = async (id: string, name: string) => {
    if ((await confirmAndDelete(id, name)) && grantedIds.has(id))
      toggle(id, false);
  };

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
        onDelete={(id, name) => void disconnect(id, name)}
        deletingId={deletingId}
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
