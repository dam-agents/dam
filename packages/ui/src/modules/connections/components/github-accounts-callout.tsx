import type { ConnectionView } from "api-server-api";
import { githubAccountGroups } from "api-server-api";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

export interface GrantDetails {
  grantedAt: string;
  preferred: boolean;
}

interface Props {
  granted: readonly ConnectionView[];
  grants: ReadonlyMap<string, GrantDetails>;
  onPrefer: (connectionId: string) => void;
  className?: string;
}

export function GitHubAccountsCallout({
  granted,
  grants,
  onPrefer,
  className,
}: Props) {
  const groups = useMemo(
    () =>
      githubAccountGroups(
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
      inset
      className={cn("flex flex-col gap-3 text-sm text-foreground", className)}
      data-testid="github-accounts-callout"
    >
      {groups.map((group) => {
        const active = group.accounts.find((account) => account.active);
        return (
          <div key={group.host} className="flex flex-col gap-2">
            <p>
              On {group.host} this agent acts as{" "}
              <strong>{active?.connectionName}</strong> unless it switches
              itself with <code>gh auth switch</code>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {group.accounts
                .filter((account) => !account.active)
                .map((account) => (
                  <Button
                    key={account.connectionId}
                    variant="outline"
                    size="sm"
                    onClick={() => onPrefer(account.connectionId)}
                    data-testid={`prefer-connection-${account.connectionId}`}
                  >
                    Act as {account.connectionName} by default
                  </Button>
                ))}
            </div>
          </div>
        );
      })}
    </Callout>
  );
}
