import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import type { RowMaintenanceActions } from "../components/catalog-connection-row.js";
import { useReauthenticateConnection } from "./use-reauthenticate-connection.js";

export function useConnectionMaintenance() {
  const [updating, setUpdating] = useState<ConnectionView | null>(null);
  const [editingScope, setEditingScope] = useState<ConnectionView | null>(null);
  const { reauthenticate, busyId } = useReauthenticateConnection();

  const openUpdate = (connection: ConnectionView) => {
    setEditingScope(null);
    setUpdating(connection);
  };
  const openEditScope = (connection: ConnectionView) => {
    setUpdating(null);
    setEditingScope(connection);
  };

  const rowActions = (
    connection: ConnectionView,
  ): RowMaintenanceActions | undefined => {
    switch (connection.authKind) {
      case "oauth":
        return {
          onReauthenticate: () => void reauthenticate(connection),
          busy: busyId === connection.id,
          ...(connection.hasClientSecret
            ? { onUpdateCredential: () => openUpdate(connection) }
            : {}),
        };
      case "header":
      case "client-credentials":
        return { onUpdateCredential: () => openUpdate(connection) };
      case "github-app":
        return {
          onUpdateCredential: () => openUpdate(connection),
          onEditScope: () => openEditScope(connection),
        };
      case "none":
        return undefined;
    }
  };

  return {
    rowActions,
    updating,
    closeUpdate: () => setUpdating(null),
    editingScope,
    closeEditScope: () => setEditingScope(null),
  };
}
