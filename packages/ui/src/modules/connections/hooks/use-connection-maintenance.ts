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

  const signInActions = (
    connection: ConnectionView,
  ): RowMaintenanceActions => ({
    onReauthenticate: () => void reauthenticate(connection),
    busy: busyId === (connection.parentId ?? connection.id),
  });

  const rowActions = (
    connection: ConnectionView,
  ): RowMaintenanceActions | undefined => {
    switch (connection.authKind) {
      case "oauth":
        if (connection.parentId)
          return {
            ...signInActions(connection),
            ...(connection.status !== "pending"
              ? { onEditScope: () => openEditScope(connection) }
              : {}),
          };
        return {
          ...signInActions(connection),
          ...(connection.hasClientSecret
            ? { onUpdateCredential: () => openUpdate(connection) }
            : {}),
          ...(connection.githubUserToken && connection.status !== "pending"
            ? { onEditScope: () => openEditScope(connection) }
            : {}),
        };
      case "header":
      case "client-credentials":
      case "sigv4":
        return { onUpdateCredential: () => openUpdate(connection) };
      case "github-app":
        if (connection.isParent)
          return { onUpdateCredential: () => openUpdate(connection) };
        if (connection.parentId)
          return { onEditScope: () => openEditScope(connection) };
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
