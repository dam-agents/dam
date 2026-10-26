import type { ConnectionView } from "api-server-api";

import { connectionScopeSummary, fullAccessLine } from "./github-access.js";

export interface ConnectionDetail {
  account?: string;
  reach?: { text: string; fullAccess: boolean };
}

type DetailedConnection = Pick<
  ConnectionView,
  | "authKind"
  | "accountLabel"
  | "isParent"
  | "fullAccess"
  | "githubUserToken"
  | "githubAppScope"
  | "check"
>;

function accountLine(connection: DetailedConnection): string | undefined {
  if (connection.accountLabel) return `Acts as ${connection.accountLabel}`;
  const installedOn = connection.check?.installedOn;
  if (connection.isParent && installedOn) return `Installed on ${installedOn}`;
  return undefined;
}

export function connectionDetail(
  connection: DetailedConnection,
): ConnectionDetail {
  const account = accountLine(connection);
  if (connection.fullAccess)
    return {
      account,
      reach: { text: fullAccessLine(connection), fullAccess: true },
    };
  const scope = connectionScopeSummary(connection);
  return {
    account,
    ...(scope ? { reach: { text: scope, fullAccess: false } } : {}),
  };
}
