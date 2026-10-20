import type {
  ConnectionView,
  DefaultAccountGroup,
  DefaultAccountKindId,
} from "api-server-api";
import { contestedDefaultAccounts } from "api-server-api";
import { type ReactNode, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

export interface GrantDetails {
  grantedAt: string;
  preferred: boolean;
}

interface Wording {
  current: (group: DefaultAccountGroup, active: ReactNode) => ReactNode;
  prefer: (connectionName: string) => string;
}

const WORDING: Record<DefaultAccountKindId, Wording> = {
  github: {
    current: (group, active) => (
      <>
        On {group.scope} this agent acts as {active} unless it switches itself
        with <code>gh auth switch</code>.
      </>
    ),
    prefer: (name) => `Act as ${name} by default`,
  },
  "aws-profile": {
    current: (_group, active) => (
      <>
        For Object Storage this agent uses {active} unless it names another
        profile with <code>--profile</code>.
      </>
    ),
    prefer: (name) => `Use ${name} by default`,
  },
};

interface Props {
  granted: readonly ConnectionView[];
  grants: ReadonlyMap<string, GrantDetails>;
  onPrefer: (connectionId: string) => void;
  pending?: boolean;
  className?: string;
}

export function DefaultAccountsCallout({
  granted,
  grants,
  onPrefer,
  pending = false,
  className,
}: Props) {
  const groups = useMemo(
    () =>
      contestedDefaultAccounts(
        granted.map((connection) => {
          const grant = grants.get(connection.id);
          return {
            id: connection.id,
            name: connection.name,
            preferred: grant?.preferred ?? false,
            ...(grant ? { grantedAt: grant.grantedAt } : {}),
            contributions: connection.contributions,
          };
        }),
      ),
    [granted, grants],
  );
  if (groups.length === 0) return null;
  return (
    <Callout
      tone="info"
      size="sm"
      className={cn("flex flex-col gap-3 text-sm text-foreground", className)}
      data-testid="default-accounts-callout"
    >
      {groups.map((group) => {
        const wording = WORDING[group.kind];
        const active = group.accounts.find((account) => account.active);
        return (
          <div
            key={group.key}
            className="flex flex-col gap-2"
            data-testid={`default-accounts-${group.kind}`}
          >
            <p>
              {wording.current(
                group,
                <strong>{active?.connectionName}</strong>,
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {group.accounts
                .filter((account) => !account.active)
                .map((account) => (
                  <Button
                    key={account.connectionId}
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => onPrefer(account.connectionId)}
                    data-testid={`prefer-connection-${account.connectionId}`}
                  >
                    {wording.prefer(account.connectionName)}
                  </Button>
                ))}
            </div>
          </div>
        );
      })}
    </Callout>
  );
}
