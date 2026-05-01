import { useMutation } from "@tanstack/react-query";

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
