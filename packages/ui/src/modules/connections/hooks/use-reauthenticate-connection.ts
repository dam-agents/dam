import type { ConnectionView } from "api-server-api";
import { useRef, useState } from "react";

import { emitToast } from "@/lib/toast";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { type OAuthPopupResult, useOAuthPopup } from "./use-oauth-popup.js";

interface Pending {
  id: string;
  /** `connectedAt` as it was before consent — how a completion is recognized. */
  connectedAt: string | undefined;
}

/**
 * Re-runs login/consent against an existing OAuth connection. Unlike the create
 * flow this never deletes anything on abandon: the connection keeps working on
 * its old credential, so there is no husk to clean up.
 */
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
    // A closed popup means cancelled *or* completed — its result message only
    // reaches the deployed origin. The server decides: a consent that landed
    // advanced `connectedAt`.
    try {
      const conn = await api.connections.get.query({ id: pending.id });
      if (conn && conn.connectedAt !== pending.connectedAt) {
        emitToast({ kind: "success", message: "Connection re-authenticated." });
        return;
      }
    } catch {
      // Status unknown — report the popup's own outcome below.
    }
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
    // One consent at a time: the popup is a *named* window, so opening a
    // second flow — even for a different connection — would navigate the
    // first one away mid-consent and silently orphan it. Bring the open
    // popup back to the front instead.
    if (busyId !== null) {
      focusPopup();
      return;
    }
    // Must open synchronously or the browser blocks it; navigated below.
    const popup = openPopup();
    setBusyId(connection.id);
    pendingRef.current = {
      id: connection.id,
      connectedAt: connection.connectedAt,
    };
    try {
      const { authUrl } = await api.connections.startOAuth.mutate({
        connectionId: connection.id,
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
