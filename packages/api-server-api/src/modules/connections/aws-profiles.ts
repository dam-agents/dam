import type { Contribution } from "agent-runtime-api";
import { connectionEgressPlaceholder } from "./egress-addressing.js";
import { byGrantTime } from "./github-accounts.js";

export const AWS_CREDENTIALS_FILE_PATH = "$HOME/.aws/credentials";
export const AWS_CONFIG_FILE_PATH = "$HOME/.aws/config";
export const AWS_PROFILE_ENV = "AWS_PROFILE";

const DUMMY_SECRET_ACCESS_KEY = "signed-by-the-gateway";
const RESERVED_PROFILE = "default";

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
  endpoint: string;
  region: string;
  active: boolean;
}

function signingOf(
  contributions: readonly Contribution[],
): EgressSign | undefined {
  return contributions.find((c): c is EgressSign => c.kind === "egress-sign");
}

export function isSigv4Connection(
  contributions: readonly Contribution[],
): boolean {
  return signingOf(contributions) !== undefined;
}

function profileSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function profileNames(members: readonly AwsProfileSource[]): string[] {
  const taken = new Set<string>([RESERVED_PROFILE]);
  return members.map((member) => {
    const base = profileSlug(member.name) || "s3";
    const suffix = profileSlug(member.id);
    let name = base;
    for (let i = 0; taken.has(name); i++) {
      name = `${base}-${suffix}${i === 0 ? "" : `-${i}`}`;
    }
    taken.add(name);
    return name;
  });
}

export function awsProfileGroup(
  granted: readonly AwsProfileSource[],
): AwsProfile[] {
  const members = granted
    .filter((source) => isSigv4Connection(source.contributions))
    .sort(byGrantTime);
  const activeIndex = Math.max(
    0,
    members.findIndex((member) => member.preferred),
  );
  const names = profileNames(members);
  return members.map((member, index) => {
    const sign = signingOf(member.contributions)!;
    return {
      connectionId: member.id,
      connectionName: member.name,
      profile: names[index] ?? member.id,
      endpoint: `https://${sign.host}${sign.port ? `:${sign.port}` : ""}`,
      region: sign.region,
      active: index === activeIndex,
    };
  });
}

function credentialsFile(profiles: readonly AwsProfile[]): Contribution {
  return {
    kind: "file",
    path: AWS_CREDENTIALS_FILE_PATH,
    format: "ini",
    mergeMode: "key-targeted",
    content: Object.fromEntries(
      profiles.map((p) => [
        p.profile,
        {
          aws_access_key_id: connectionEgressPlaceholder(p.connectionId),
          aws_secret_access_key: DUMMY_SECRET_ACCESS_KEY,
        },
      ]),
    ),
  };
}

function configFile(profiles: readonly AwsProfile[]): Contribution {
  return {
    kind: "file",
    path: AWS_CONFIG_FILE_PATH,
    format: "ini",
    mergeMode: "key-targeted",
    content: Object.fromEntries(
      profiles.map((p) => [
        `profile ${p.profile}`,
        {
          region: p.region,
          endpoint_url: p.endpoint,
          s3: { addressing_style: "path" },
          request_checksum_calculation: "when_required",
          response_checksum_validation: "when_required",
        },
      ]),
    ),
  };
}

export function composeAwsProfiles(
  granted: readonly AwsProfileSource[],
): Contribution[] {
  const profiles = awsProfileGroup(granted);
  if (profiles.length === 0) return [];
  const active = profiles.find((p) => p.active) ?? profiles[0]!;
  return [
    credentialsFile(profiles),
    configFile(profiles),
    { kind: "env", name: AWS_PROFILE_ENV, placeholder: active.profile },
  ];
}
