import type {
  ConnectionCreateInput,
  ConnectionTemplateView,
} from "api-server-api";
import { useRef, useState } from "react";

import { getErrorMessage } from "@/lib/errors";
import { emitToast } from "@/lib/toast";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { routeToPath } from "../../platform/lib/routes.js";
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

  const discardPending = async (id: string) => {
    try {
      await api.connections.delete.mutate({ id });
      void invalidateConnections();
    } catch {}
  };

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
      fail(result.message ?? "Authorization was cancelled.");
      return;
    }
    await discardPending(id);
    fail(result.message ?? "Authorization was cancelled.");
  };

  const {
    open: openPopup,
    close: closePopup,
    focus: focusPopup,
  } = useOAuthPopup((result) => void settlePopup(result));

  const needsOAuth = template.authKind === "oauth";
  const pending =
    create.isPending ||
    authorizing ||
    discover.isPending ||
    probeClusterCa.isPending;

  const submit = async (payload: ConnectionCreateInput) => {
    if (needsOAuth) {
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
          return;
        }
      }

      const popup = popupOAuth ? openPopup() : null;
      setAuthorizing(true);
      let created: { id: string };
      try {
        created = await create.mutateAsync(payload);
      } catch {
        closePopup();
        setAuthorizing(false);
        return;
      }
      try {
        if (popup) {
          if (popup.closed) {
            setAuthorizing(false);
            void discardPending(created.id);
            fail("Authorization was cancelled.");
            return;
          }
          pendingIdRef.current = created.id;
          const r = await api.connections.startOAuth.mutate({
            connectionId: created.id,
            popup: true,
          });
          popup.location.href = r.authUrl;
          return;
        }
        const r = await api.connections.startOAuth.mutate({
          connectionId: created.id,
          ...(oauthReturnView ? { returnTo: oauthReturnView } : {}),
        });
        if (!oauthReturnView)
          sessionStorage.setItem(
            "platform-return-view",
            routeToPath({ view: "settings", settingsTab: "connections" }),
          );
        window.location.href = r.authUrl;
      } catch (err) {
        closePopup();
        pendingIdRef.current = null;
        setAuthorizing(false);
        void discardPending(created.id);
        fail(getErrorMessage(err));
      }
      return;
    }
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
      } catch {}
    }

    try {
      const result = await create.mutateAsync(payload);
      onCreated(result.id);
    } catch {}
  };

  return {
    submit,
    pending,
    authorizing,
    verifying: discover.isPending,
    needsOAuth,
    awaitingPopup: !!popupOAuth && authorizing,
    refocusPopup: focusPopup,
  };
}
