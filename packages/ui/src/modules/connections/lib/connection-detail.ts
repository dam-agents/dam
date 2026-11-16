import type { ConnectionView } from "api-server-api";

import { getBrand } from "../../../brand.js";
import { damActsAsYou, isDamConnection } from "./dam-connection.js";
import { connectionScopeSummary, fullAccessReach } from "./github-access.js";

export interface ConnectionDetail {
  account?: string;
  reach?: { text: string; title?: string };
}

type DetailedConnection = Pick<
  ConnectionView,
  | "templateId"
  | "authKind"
  | "accountLabel"
  | "isParent"
  | "fullAccess"
  | "githubUserToken"
  | "githubAppScope"
  | "check"
>;

function accountLine(connection: DetailedConnection): string | undefined {
  if (isDamConnection(connection)) return damActsAsYou(getBrand().name);
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
    return { account, reach: { text: fullAccessReach(connection) } };
  const scope = connectionScopeSummary(connection);
  if (!scope) return { account };
  const listed = connectionScopeSummary(connection, "list");
  return {
    account,
    reach: {
      text: scope,
      ...(listed && listed !== scope ? { title: listed } : {}),
    },
  };
}
