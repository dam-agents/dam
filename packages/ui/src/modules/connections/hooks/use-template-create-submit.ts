import type {
  ConnectionCreateInput,
  ConnectionTemplateView,
} from "api-server-api";
import { useRef, useState } from "react";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import {
  useCreateConnection,
  useDiscoverMcp,
  useProbeClusterCa,
} from "../api/mutations.js";
import { validateMcpUrl } from "../lib/mcp-url.js";
import { useOAuthPopup } from "./use-oauth-popup.js";

/** The create-and-authorize orchestration behind the template create form:
 *  MCP OAuth discovery, kubernetes CA probing, popup OAuth with full-page
 *  fallback, and the plain create path. Presentation stays in the form. */
export function useTemplateCreateSubmit({
  template,
  popupOAuth,
  oauthReturnView,
  onOAuthRedirect,
  onCreated,
}: {
  template: ConnectionTemplateView;
  popupOAuth?: boolean;
  oauthReturnView?: string;
  onOAuthRedirect?: (connectionId: string) => void;
  onCreated: (id: string) => void;
}) {
  const create = useCreateConnection();
  const discover = useDiscoverMcp();
  const probeClusterCa = useProbeClusterCa();

  const [error, setError] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

  const pendingIdRef = useRef<string | null>(null);
  const { open: openPopup, close: closePopup } = useOAuthPopup((result) => {
    setAuthorizing(false);
    if (result.ok && pendingIdRef.current) {
      // No page reload happened, so refresh the list ourselves.
      void queryClient.invalidateQueries({
        queryKey: trpc.connections.list.queryKey(),
      });
      onCreated(pendingIdRef.current);
    } else if (result.message) setError(result.message);
    pendingIdRef.current = null;
  });

  const needsOAuth = template.authKind === "oauth";
  const pending =
    create.isPending ||
    authorizing ||
    discover.isPending ||
    probeClusterCa.isPending;

  const submit = async (payload: ConnectionCreateInput) => {
    setError(null);
    if (needsOAuth) {
      // Custom MCP servers are reached by a user-typed URL. Verify it exposes
      // OAuth discovery metadata before opening any tab, so an unreachable or
      // non-OAuth URL fails inline here instead of flashing a popup that the
      // create call would immediately close. Premade providers carry no `url`
      // input and skip this, keeping their synchronous popup.
      const mcpUrl = payload.authKind === "oauth" ? payload.url : undefined;
      if (mcpUrl) {
        const urlError = validateMcpUrl(mcpUrl);
        if (urlError) {
          setError(urlError);
          return;
        }
        try {
          const { auth } = await discover.mutateAsync({ url: mcpUrl });
          if (auth !== "oauth") {
            setError(
              "Couldn't find OAuth discovery metadata at this URL. Check that it points to an MCP server that supports OAuth (we look for /.well-known/oauth-* endpoints).",
            );
            return;
          }
        } catch {
          // A transport/server failure is surfaced by the mutation's error toast.
          return;
        }
      }

      // Open the popup synchronously (or it gets blocked); navigate it below.
      const popup = popupOAuth ? openPopup() : null;
      if (popup) {
        setAuthorizing(true);
        try {
          const result = await api.connections.create.mutate(payload);
          pendingIdRef.current = result.id;
          const r = await api.connections.startOAuth.mutate({
            connectionId: result.id,
            popup: true,
          });
          popup.location.href = r.authUrl;
        } catch (err) {
          closePopup();
          pendingIdRef.current = null;
          setAuthorizing(false);
          setError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // Fallback: full-page redirect (popup blocked, or not requested).
      setAuthorizing(true);
      try {
        const result = await api.connections.create.mutate(payload);
        const r = await api.connections.startOAuth.mutate({
          connectionId: result.id,
          ...(oauthReturnView ? { returnTo: oauthReturnView } : {}),
        });
        if (oauthReturnView) onOAuthRedirect?.(result.id);
        else
          sessionStorage.setItem(
            "platform-return-view",
            "/settings/connections",
          );
        window.location.href = r.authUrl;
      } catch (err) {
        setAuthorizing(false);
        setError(err instanceof Error ? err.message : String(err));
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
          setError(
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return {
    submit,
    error,
    setError,
    pending,
    authorizing,
    verifying: discover.isPending,
    needsOAuth,
  };
}
