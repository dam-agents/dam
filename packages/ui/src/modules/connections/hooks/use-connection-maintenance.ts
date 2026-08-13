import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import type { RowMaintenanceActions } from "../components/catalog-connection-row.js";
import { useReauthenticateConnection } from "./use-reauthenticate-connection.js";

/** Which action each row offers, plus the dialog state behind it. One owner so
 *  the surfaces listing connections can't drift on what each auth kind gets. */
export function useConnectionMaintenance() {
  const [updating, setUpdating] = useState<ConnectionView | null>(null);
  const [editingScope, setEditingScope] = useState<ConnectionView | null>(null);
  const { reauthenticate, busyId } = useReauthenticateConnection();

  // At most one dialog is open at a time, and opening either clears the other.
  // Two live slots would let one shadow the other — a stale scope target would
  // render its editor when a later row asked for the credential dialog, bound
  // to a connection the user is no longer looking at.
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
      // Consent is the only way to mint an OAuth *token*; a connection holding
      // its own client secret also offers that secret's rotation.
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
      // A GitHub App connection additionally owns which repositories and
      // permissions it mints against, and that is editable in place — the
      // credential and every grant stay put.
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
