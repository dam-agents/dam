import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import { useFeatures } from "../../features/api/queries.js";
import { useConnectionTemplates } from "../api/queries.js";
import type { RowMaintenanceActions } from "../components/catalog-connection-row.js";
import {
  gheSignInOfferedHosts,
  movesBetweenHosts,
  otherHosts,
} from "../lib/github-enterprise-hosts.js";
import { useReauthenticateConnection } from "./use-reauthenticate-connection.js";

export function useConnectionMaintenance() {
  const [updating, setUpdating] = useState<ConnectionView | null>(null);
  const [editingScope, setEditingScope] = useState<ConnectionView | null>(null);
  const [movingHost, setMovingHost] = useState<ConnectionView | null>(null);
  const { reauthenticate, busyId } = useReauthenticateConnection();
  const hostsEnabled = useFeatures().data?.["github-enterprise-hosts"] ?? false;
  const offeredHosts = gheSignInOfferedHosts(
    useConnectionTemplates().data ?? [],
  );

  const openUpdate = (connection: ConnectionView) => {
    setEditingScope(null);
    setMovingHost(null);
    setUpdating(connection);
  };
  const openEditScope = (connection: ConnectionView) => {
    setUpdating(null);
    setMovingHost(null);
    setEditingScope(connection);
  };
  const openMoveHost = (connection: ConnectionView) => {
    setUpdating(null);
    setEditingScope(null);
    setMovingHost(connection);
  };

  const moveHostAction = (
    connection: ConnectionView,
  ): Pick<RowMaintenanceActions, "onMoveHost"> =>
    movesBetweenHosts(connection) &&
    (hostsEnabled || connection.retiredHost) &&
    otherHosts(offeredHosts, connection).length > 0
      ? { onMoveHost: () => openMoveHost(connection) }
      : {};

  const signInActions = (
    connection: ConnectionView,
  ): RowMaintenanceActions => ({
    ...(connection.status !== "disconnected"
      ? { onReauthenticate: () => void reauthenticate(connection) }
      : {}),
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
          ...moveHostAction(connection),
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
    movingHost: movingHost
      ? {
          connection: movingHost,
          hosts: otherHosts(offeredHosts, movingHost),
          onMoved: (connection: ConnectionView) => {
            setMovingHost(null);
            void reauthenticate(connection);
          },
        }
      : null,
    closeMoveHost: () => setMovingHost(null),
  };
}
