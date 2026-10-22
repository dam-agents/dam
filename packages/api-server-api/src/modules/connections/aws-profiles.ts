import type { Contribution } from "agent-runtime-api";
import {
  defaultAccountGroups,
  type DefaultAccountKind,
  type DefaultAccountSource,
} from "./default-accounts.js";
import { connectionEgressPlaceholder } from "./egress-addressing.js";

export const AWS_CREDENTIALS_FILE_PATH = "$HOME/.aws/credentials";
export const AWS_CONFIG_FILE_PATH = "$HOME/.aws/config";
export const AWS_PROFILE_ENV = "AWS_PROFILE";
export const AWS_PLACEHOLDER_SECRET_KEY = "signed-by-gateway";

const AWS_PROFILE_KIND = "aws-profile";

type EgressSign = Extract<Contribution, { kind: "egress-sign" }>;

export type AwsProfileSource = DefaultAccountSource;

export interface AwsProfile {
  connectionId: string;
  connectionName: string;
  profile: string;
  active: boolean;
  endpointUrl: string;
  region: string;
}

export function signingTargetOf(
  contributions: readonly Contribution[],
): EgressSign | undefined {
  return contributions.find((c): c is EgressSign => c.kind === "egress-sign");
}

export function awsProfileSlug(text: string): string {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((part) => part !== "")
    .join("-");
}

export const awsProfileKind: DefaultAccountKind<typeof AWS_PROFILE_KIND> = {
  id: AWS_PROFILE_KIND,
  scopeOf: (contributions) =>
    signingTargetOf(contributions) === undefined ? undefined : "",
  naming: {
    slug: awsProfileSlug,
    fallback: "storage",
    reserved: new Set(["default"]),
    idSuffixLength: 8,
  },
  minAccounts: 1,
};

export function awsProfiles(
  granted: readonly AwsProfileSource[],
): AwsProfile[] {
  const [group] = defaultAccountGroups(awsProfileKind, granted);
  return (group?.accounts ?? []).flatMap((account) => {
    const target = signingTargetOf(account.contributions);
    if (!target) return [];
    return [
      {
        connectionId: account.connectionId,
        connectionName: account.connectionName,
        profile: account.name,
        active: account.active,
        endpointUrl: `https://${target.host}${target.port ? `:${target.port}` : ""}`,
        region: target.region,
      },
    ];
  });
}

function credentialsFile(profile: AwsProfile): Contribution {
  return {
    kind: "file",
    path: AWS_CREDENTIALS_FILE_PATH,
    format: "ini",
    mergeMode: "key-targeted",
    content: {
      [profile.profile]: {
        aws_access_key_id: connectionEgressPlaceholder(profile.connectionId),
        aws_secret_access_key: AWS_PLACEHOLDER_SECRET_KEY,
      },
    },
  };
}

function configFile(profile: AwsProfile): Contribution {
  return {
    kind: "file",
    path: AWS_CONFIG_FILE_PATH,
    format: "ini",
    mergeMode: "key-targeted",
    content: {
      [`profile ${profile.profile}`]: {
        region: profile.region,
        endpoint_url: profile.endpointUrl,
        s3: "\n  addressing_style = path",
        request_checksum_calculation: "when_required",
        response_checksum_validation: "when_required",
      },
    },
  };
}

export function composeAwsProfiles(
  granted: readonly AwsProfileSource[],
): Contribution[] {
  const profiles = awsProfiles(granted);
  if (profiles.length === 0) return [];
  const active = profiles.find((p) => p.active) ?? profiles[0]!;
  return [
    ...profiles.flatMap((profile) => [
      credentialsFile(profile),
      configFile(profile),
    ]),
    { kind: "env", name: AWS_PROFILE_ENV, placeholder: active.profile },
  ];
}
