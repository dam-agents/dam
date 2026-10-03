import type { ConnectionView } from "api-server-api";
import { awsProfileGroup } from "api-server-api";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import type { GrantDetails } from "./github-accounts-callout.js";

interface Props {
  granted: readonly ConnectionView[];
  grants: ReadonlyMap<string, GrantDetails>;
  onPrefer: (connectionId: string) => void;
  pending?: boolean;
  className?: string;
}

export function AwsProfilesCallout({
  granted,
  grants,
  onPrefer,
  pending = false,
  className,
}: Props) {
  const profiles = useMemo(
    () =>
      awsProfileGroup(
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
  if (profiles.length < 2) return null;
  const active = profiles.find((profile) => profile.active);
  return (
    <Callout
      tone="info"
      size="sm"
      inset
      className={cn("flex flex-col gap-2 text-sm text-foreground", className)}
      data-testid="aws-profiles-callout"
    >
      <p>
        The AWS CLI on this agent uses <strong>{active?.connectionName}</strong>{" "}
        unless it passes <code>--profile</code>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {profiles
          .filter((profile) => !profile.active)
          .map((profile) => (
            <Button
              key={profile.connectionId}
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => onPrefer(profile.connectionId)}
              data-testid={`prefer-connection-${profile.connectionId}`}
            >
              Use {profile.connectionName} by default
            </Button>
          ))}
      </div>
    </Callout>
  );
}
