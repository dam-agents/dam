import {
  contestedDefaultAccounts,
  type ConnectionView,
  type DefaultAccountKindId,
} from "api-server-api";
import type { AgentGrant } from "../services/connection-service.js";

export interface DefaultMark {
  kind: DefaultAccountKindId;
  scope: string;
  active: boolean;
}

export function defaultMarks(
  granted: readonly ConnectionView[],
  grants: readonly AgentGrant[],
): Map<string, DefaultMark> {
  const byId = new Map(grants.map((g) => [g.connectionId, g]));
  const groups = contestedDefaultAccounts(
    granted.map((c) => {
      const grant = byId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        preferred: grant?.preferred ?? false,
        ...(grant && { grantedAt: grant.grantedAt }),
        contributions: c.contributions,
      };
    }),
  );
  return new Map(
    groups.flatMap((group) =>
      group.accounts.map((account) => [
        account.connectionId,
        { kind: group.kind, scope: group.scope, active: account.active },
      ]),
    ),
  );
}

export function defaultCell(mark: DefaultMark | undefined): string {
  if (!mark) return "—";
  return mark.active ? "yes" : "no";
}
