import type { ConnectionCreateInput } from "api-server-api";

import { useCreateConnection } from "../../connections/api/mutations.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";

export type GithubMode = "github" | "github-enterprise";

export interface EnsuredConnection {
  id: string;
  /** Already authorized (active) — no OAuth redirect needed. */
  active: boolean;
}

export function useGithubConnect() {
  const { data: templates = [] } = useConnectionTemplates();
  const { data: connections = [] } = useAppConnections();
  const createConnection = useCreateConnection();

  const isBringYourOwnApp = (mode: GithubMode): boolean =>
    templates
      .find((t) => t.id === mode)
      ?.inputs.find((i) => i.name === "clientId")?.state === "required";

  // Operator-configured GHE host (Helm `defaultGithubEnterpriseHost`) ships as
  // the template's host preset; when present the user need not type it.
  const ghePresetHost: string | undefined = templates
    .find((t) => t.id === "github-enterprise")
    ?.inputs.find((i) => i.name === "host")?.presetValue;

  // GitHub.com is one-per-user; GHE is keyed by host so distinct hosts get
  // distinct connections rather than colliding on a single record.
  const findExisting = (mode: GithubMode, host: string) =>
    connections.find((c) =>
      mode === "github"
        ? c.templateId === "github"
        : c.templateId === "github-enterprise" && c.host === host,
    );

  const ensureConnectionId = async (
    mode: GithubMode,
    host: string,
    creds: { clientId: string; clientSecret: string },
  ): Promise<EnsuredConnection> => {
    const existing = findExisting(mode, host);
    if (existing)
      return { id: existing.id, active: existing.status === "active" };

    const payload: ConnectionCreateInput = {
      templateId: mode,
      name: mode === "github" ? "github" : `ghe-${slugifyHost(host)}`,
      authKind: "oauth",
      ...(mode === "github-enterprise" ? { host } : {}),
      ...(creds.clientId ? { clientId: creds.clientId } : {}),
      ...(creds.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    };
    const { id } = await createConnection.mutateAsync(payload);
    return { id, active: false };
  };

  return {
    isBringYourOwnApp,
    ghePresetHost,
    findExisting,
    ensureConnectionId,
    creating: createConnection.isPending,
  };
}

function slugifyHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 55);
}
