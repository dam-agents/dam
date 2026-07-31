import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import type { RowMaintenanceActions } from "../components/catalog-connection-row.js";
import { useReauthenticateConnection } from "./use-reauthenticate-connection.js";

/**
 * Credential maintenance for a list of connection rows: which action each row
 * offers, and the dialog state behind "Update credential". One owner so the
 * settings page and the sandbox panel can't drift on which auth kind gets
 * which affordance.
 */
export function useConnectionMaintenance() {
  const [updating, setUpdating] = useState<ConnectionView | null>(null);
  const { reauthenticate, busyId } = useReauthenticateConnection();

  const rowActions = (
    connection: ConnectionView,
  ): RowMaintenanceActions | undefined => {
    switch (connection.authKind) {
      // Consent is the only way to mint an OAuth credential; pasting one is
      // meaningless.
      case "oauth":
        return {
          onReauthenticate: () => void reauthenticate(connection),
          busy: busyId === connection.id,
        };
      case "header":
      case "client-credentials":
      case "github-app":
        return { onUpdateCredential: () => setUpdating(connection) };
      // Nothing is stored, so there is nothing to maintain.
      case "none":
        return undefined;
    }
  };

  return {
    rowActions,
    /** The connection whose credential dialog is open, if any. */
    updating,
    closeUpdate: () => setUpdating(null),
  };
}
