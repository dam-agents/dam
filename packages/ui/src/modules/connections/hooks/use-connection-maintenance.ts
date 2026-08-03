import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import type { RowMaintenanceActions } from "../components/catalog-connection-row.js";
import { useReauthenticateConnection } from "./use-reauthenticate-connection.js";

/** Which action each row offers, plus the dialog state behind it. One owner so
 *  the surfaces listing connections can't drift on what each auth kind gets. */
export function useConnectionMaintenance() {
  const [updating, setUpdating] = useState<ConnectionView | null>(null);
  const { reauthenticate, busyId } = useReauthenticateConnection();

  const rowActions = (
    connection: ConnectionView,
  ): RowMaintenanceActions | undefined => {
    switch (connection.authKind) {
      // Consent is the only way to mint an OAuth *token*; a connection holding
      // its own client secret also offers that secret's rotation.
      case "oauth":
        return {
          onReauthenticate: () => void reauthenticate(connection),
          busy: busyId === connection.id,
          ...(connection.hasClientSecret
            ? { onUpdateCredential: () => setUpdating(connection) }
            : {}),
        };
      case "header":
      case "client-credentials":
      case "github-app":
        return { onUpdateCredential: () => setUpdating(connection) };
      case "none":
        return undefined;
    }
  };

  return {
    rowActions,
    updating,
    closeUpdate: () => setUpdating(null),
  };
}
