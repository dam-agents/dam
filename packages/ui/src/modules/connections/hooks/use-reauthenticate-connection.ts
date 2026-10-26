import type { ConnectionView } from "api-server-api";
import { useRef, useState } from "react";

import { emitToast } from "@/lib/toast";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { type OAuthPopupResult, useOAuthPopup } from "./use-oauth-popup.js";

interface Pending {
  id: string;
  connectedAt: string | undefined;
}

function signInOf(connection: ConnectionView): Pending {
  if (!connection.parentId)
    return { id: connection.id, connectedAt: connection.connectedAt };
  const parent = queryClient
    .getQueryData<ConnectionView[]>(trpc.connections.list.queryKey())
    ?.find((c) => c.id === connection.parentId);
  return { id: connection.parentId, connectedAt: parent?.connectedAt };
}

export function useReauthenticateConnection() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = async (result: OAuthPopupResult) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setBusyId(null);
    if (!pending) return;
    void queryClient.invalidateQueries({
      queryKey: trpc.connections.list.queryKey(),
    });
    if (result.ok) {
      emitToast({ kind: "success", message: "Connection re-authenticated." });
      return;
    }
    try {
      const conn = await api.connections.get.query({ id: pending.id });
      if (conn && conn.connectedAt !== pending.connectedAt) {
        emitToast({ kind: "success", message: "Connection re-authenticated." });
        return;
      }
    } catch {}
    emitToast({
      kind: "error",
      message: result.message ?? "Authorization was cancelled.",
    });
  };

  const {
    open: openPopup,
    close: closePopup,
    focus: focusPopup,
  } = useOAuthPopup((result) => void settle(result));

  const reauthenticate = async (connection: ConnectionView) => {
    if (busyId !== null) {
      focusPopup();
      return;
    }
    const signIn = signInOf(connection);
    const popup = openPopup();
    setBusyId(signIn.id);
    pendingRef.current = signIn;
    try {
      const { authUrl } = await api.connections.startOAuth.mutate({
        connectionId: signIn.id,
        ...(popup ? { popup: true } : { returnTo: window.location.pathname }),
      });
      if (popup) {
        popup.location.href = authUrl;
        return;
      }
      window.location.href = authUrl;
    } catch (err) {
      closePopup();
      pendingRef.current = null;
      setBusyId(null);
      emitToast({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return { reauthenticate, busyId };
}
