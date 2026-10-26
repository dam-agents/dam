import type { ConnectionView } from "api-server-api";

import { connectionScopeSummary, fullAccessLine } from "./github-access.js";

export interface ConnectionDetail {
  account?: string;
  reach?: { text: string; fullAccess: boolean; title?: string };
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
  if (!scope) return { account };
  const listed = connectionScopeSummary(connection, "list");
  return {
    account,
    reach: {
      text: scope,
      fullAccess: false,
      ...(listed && listed !== scope ? { title: listed } : {}),
    },
  };
}
