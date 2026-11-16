import {
  contestedDefaultAccounts,
  preferenceGroupOf,
  type ConnectionView,
  type DefaultAccountKindId,
} from "api-server-api";

export interface AgentGrant {
  connectionId: string;
  grantedAt: string;
  preferred: boolean;
}

export interface DefaultMark {
  kind: DefaultAccountKindId;
  scope: string;
  active: boolean;
}

export function isDefaultAccount(connection: ConnectionView): boolean {
  return preferenceGroupOf(connection.contributions) !== undefined;
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
