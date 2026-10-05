import type { Contribution } from "agent-runtime-api";
import { connectionEgressPlaceholder } from "./egress-addressing.js";

export const AWS_CREDENTIALS_FILE_PATH = "$HOME/.aws/credentials";
export const AWS_CONFIG_FILE_PATH = "$HOME/.aws/config";
export const AWS_PROFILE_ENV = "AWS_PROFILE";
export const AWS_PLACEHOLDER_SECRET_KEY = "signed-by-gateway";

const RESERVED_PROFILE_NAMES = new Set(["default"]);
const FALLBACK_PROFILE_NAME = "storage";
const ID_SUFFIX_LENGTH = 8;

type EgressSign = Extract<Contribution, { kind: "egress-sign" }>;

export interface AwsProfileSource {
  id: string;
  name: string;
  preferred: boolean;
  grantedAt?: string;
  contributions: Contribution[];
}

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

function profileNames(members: readonly AwsProfileSource[]): string[] {
  const taken = new Set<string>();
  return members.map((member) => {
    const base = awsProfileSlug(member.name) || FALLBACK_PROFILE_NAME;
    const name =
      taken.has(base) || RESERVED_PROFILE_NAMES.has(base)
        ? `${base}-${awsProfileSlug(member.id).slice(0, ID_SUFFIX_LENGTH)}`
        : base;
    taken.add(name);
    return name;
  });
}

function byGrantTime(a: AwsProfileSource, b: AwsProfileSource): number {
  if (a.grantedAt !== b.grantedAt) {
    if (a.grantedAt === undefined) return 1;
    if (b.grantedAt === undefined) return -1;
    return a.grantedAt < b.grantedAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function awsProfiles(
  granted: readonly AwsProfileSource[],
): AwsProfile[] {
  const members = granted
    .flatMap((source) => {
      const target = signingTargetOf(source.contributions);
      return target ? [{ source, target }] : [];
    })
    .sort((a, b) => byGrantTime(a.source, b.source));
  const activeIndex = Math.max(
    0,
    members.findIndex((member) => member.source.preferred),
  );
  const names = profileNames(members.map((member) => member.source));
  return members.map(({ source, target }, index) => ({
    connectionId: source.id,
    connectionName: source.name,
    profile: names[index] ?? source.id,
    active: index === activeIndex,
    endpointUrl: `https://${target.host}${target.port ? `:${target.port}` : ""}`,
    region: target.region,
  }));
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
