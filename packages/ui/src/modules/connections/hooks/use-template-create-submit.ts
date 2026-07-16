import type {
  ConnectionCreateInput,
  ConnectionTemplateView,
} from "api-server-api";
import { useRef, useState } from "react";

import { emitToast } from "@/lib/toast";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import {
  useCreateConnection,
  useDiscoverMcp,
  useProbeClusterCa,
} from "../api/mutations.js";
import { validateMcpUrl } from "../lib/mcp-url.js";
import { type OAuthPopupResult, useOAuthPopup } from "./use-oauth-popup.js";

const fail = (message: string) => emitToast({ kind: "error", message });

const invalidateConnections = () =>
  queryClient.invalidateQueries({
    queryKey: trpc.connections.list.queryKey(),
  });

/** The create-and-authorize orchestration behind the template create form:
 *  MCP OAuth discovery, kubernetes CA probing, popup OAuth with full-page
 *  fallback, and the plain create path. Errors surface as toasts. */
export function useTemplateCreateSubmit({
  template,
  popupOAuth,
  oauthReturnView,
  onCreated,
}: {
  template: ConnectionTemplateView;
  popupOAuth?: boolean;
  oauthReturnView?: string;
  onCreated: (id: string) => void;
}) {
  const create = useCreateConnection();
  const discover = useDiscoverMcp();
  const probeClusterCa = useProbeClusterCa();

  const [authorizing, setAuthorizing] = useState(false);
  const pendingIdRef = useRef<string | null>(null);

  // A connection created for an OAuth flow that never completed is useless —
  // delete it rather than leaving an "Authorizing…" husk in the catalogue.
  const discardPending = async (id: string) => {
    try {
      await api.connections.delete.mutate({ id });
      void invalidateConnections();
    } catch {
      // Best effort; the husk stays visible and deletable by hand.
    }
  };

  // The popup's result message only reaches the deployed UI origin (the Vite
  // dev server runs on a different one), and a closed popup can mean either
  // cancelled or completed — so on anything but a clear success the
  // connection's server status decides the outcome.
  const settlePopup = async (result: OAuthPopupResult) => {
    const id = pendingIdRef.current;
    pendingIdRef.current = null;
    setAuthorizing(false);
    if (!id) return;
    const succeed = () => {
      void invalidateConnections();
      onCreated(id);
    };
    if (result.ok) {
      succeed();
      return;
    }
    try {
      const conn = await api.connections.get.query({ id });
      if (conn?.status === "active") {
        succeed();
        return;
      }
    } catch {
      // Status unknown — keep the connection and report the failure.
      fail(result.message ?? "Authorization was cancelled.");
      return;
    }
    await discardPending(id);
    fail(result.message ?? "Authorization was cancelled.");
  };

  const { open: openPopup, close: closePopup } = useOAuthPopup(
    (result) => void settlePopup(result),
  );

  const needsOAuth = template.authKind === "oauth";
  const pending =
    create.isPending ||
    authorizing ||
    discover.isPending ||
    probeClusterCa.isPending;

  const submit = async (payload: ConnectionCreateInput) => {
    if (needsOAuth) {
      // Custom MCP servers are reached by a user-typed URL. Verify it exposes
      // OAuth discovery metadata before opening any tab, so an unreachable or
      // non-OAuth URL fails here instead of flashing a popup that the create
      // call would immediately close. Premade providers carry no `url` input
      // and skip this, keeping their synchronous popup.
      const mcpUrl = payload.authKind === "oauth" ? payload.url : undefined;
      if (mcpUrl) {
        const urlError = validateMcpUrl(mcpUrl);
        if (urlError) {
          fail(urlError);
          return;
        }
        try {
          const { auth } = await discover.mutateAsync({ url: mcpUrl });
          if (auth !== "oauth") {
            fail(
              "Couldn't find OAuth discovery metadata at this URL. Check that it points to an MCP server that supports OAuth (we look for /.well-known/oauth-* endpoints).",
            );
            return;
          }
        } catch {
          // The mutation's error toast surfaced the transport failure.
          return;
        }
      }

      // Open the popup synchronously (or it gets blocked); navigate it below.
      const popup = popupOAuth ? openPopup() : null;
      setAuthorizing(true);
      let created: { id: string };
      try {
        created = await create.mutateAsync(payload);
      } catch {
        // The mutation's error toast surfaced the failure.
        closePopup();
        setAuthorizing(false);
        return;
      }
      try {
        if (popup) {
          pendingIdRef.current = created.id;
          const r = await api.connections.startOAuth.mutate({
            connectionId: created.id,
            popup: true,
          });
          popup.location.href = r.authUrl;
          return;
        }
        // Fallback: full-page redirect (popup blocked, or not requested).
        const r = await api.connections.startOAuth.mutate({
          connectionId: created.id,
          ...(oauthReturnView ? { returnTo: oauthReturnView } : {}),
        });
        if (!oauthReturnView)
          sessionStorage.setItem(
            "platform-return-view",
            "/settings/connections",
          );
        window.location.href = r.authUrl;
      } catch (err) {
        closePopup();
        pendingIdRef.current = null;
        setAuthorizing(false);
        void discardPending(created.id);
        fail(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    // Probe the endpoint (unless a CA was pasted) so a private-CA cluster
    // fails here with a clear instruction instead of at use time. Reachable
    // but untrusted → must supply the CA; unreachable/failure falls through.
    if (
      template.id === "kubernetes" &&
      payload.authKind === "header" &&
      !payload.caData &&
      payload.host
    ) {
      try {
        const probe = await probeClusterCa.mutateAsync({ host: payload.host });
        if (probe.reachable && !probe.trusted) {
          fail(
            "The cluster API server's certificate isn't publicly trusted. " +
              "Paste its CA in the Cluster CA certificate field — the " +
              "certificate-authority-data value from your kubeconfig (base64 or PEM).",
          );
          return;
        }
      } catch {
        // Probe failure surfaces via the mutation's error toast; fall through.
      }
    }

    try {
      const result = await create.mutateAsync(payload);
      onCreated(result.id);
    } catch {
      // The mutation's error toast surfaced the failure.
    }
  };

  return {
    submit,
    pending,
    authorizing,
    verifying: discover.isPending,
    needsOAuth,
  };
}
