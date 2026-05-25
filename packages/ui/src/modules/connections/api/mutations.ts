import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import {
  disconnectApp,
  disconnectMcp,
  startAppOAuth,
  startMcpOAuth,
} from "./fetchers.js";
import { mcpConnectionKeys, oauthAppKeys } from "./queries.js";

export function useStartMcpOAuth() {
  return useMutation({
    mutationFn: startMcpOAuth,
    meta: { errorToast: "Couldn't start MCP connection" },
  });
}

export function useDisconnectMcp() {
  return useMutation({
    mutationFn: disconnectMcp,
    meta: {
      invalidates: [mcpConnectionKeys.list()],
      errorToast: "Couldn't disconnect MCP server",
    },
  });
}

export function useStartAppOAuth() {
  return useMutation({
    mutationFn: startAppOAuth,
    meta: { errorToast: "Couldn't start app connection" },
  });
}

export function useDisconnectApp() {
  return useMutation({
    mutationFn: disconnectApp,
    meta: {
      invalidates: [oauthAppKeys.connections()],
      errorToast: "Couldn't disconnect app",
    },
  });
}

/**
 * Template-driven Connection create (ADR-051). The server validates `inputs`
 * against the template's Zod schema; the UI just gathers user input and
 * forwards. Invalidates the connections list so the new Connection shows up.
 */
export function useCreateConnection() {
  return useMutation({
    ...trpc.connections.create.mutationOptions(),
    meta: {
      invalidates: [["connections"]],
      errorToast: "Couldn't create connection",
    },
  });
}

/** Delete a Connection. Sweeps grants + backing secret server-side. */
export function useDeleteConnection() {
  return useMutation({
    ...trpc.connections.delete.mutationOptions(),
    meta: {
      invalidates: [["connections"]],
      errorToast: "Couldn't delete connection",
    },
  });
}
