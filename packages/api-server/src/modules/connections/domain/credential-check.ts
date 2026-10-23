import {
  credentialCheckSchema,
  githubHostOf,
  type Connection,
  type Contribution,
  type CredentialCheck,
  type ProviderKeyCheck,
} from "api-server-api";
import { keyCheckOf } from "./provider-key-check.js";

export const CREDENTIAL_CHECK_INPUT_KEY = "credentialCheck";

export type CredentialCheckKind = "github-user" | "kubernetes-token";

export type CredentialProbeOutcome = Omit<CredentialCheck, "at">;

export interface CredentialProbeTarget {
  host: string;
  port?: number;
  caPem?: string;
}

export interface CredentialProbe {
  probe(
    kind: CredentialCheckKind,
    target: CredentialProbeTarget,
    value: string,
  ): Promise<CredentialProbeOutcome>;
}

export function credentialProbeTarget(
  kind: CredentialCheckKind,
  contributions: readonly Contribution[],
  caPem: string | undefined,
): CredentialProbeTarget {
  if (kind === "github-user") {
    return { host: githubHostOf(contributions) ?? "github.com" };
  }
  const inject = contributions.find((c) => c.kind === "egress-inject");
  if (inject?.kind !== "egress-inject") {
    throw new Error("a Kubernetes connection injects its token on one host");
  }
  return {
    host: inject.host,
    ...(inject.port ? { port: inject.port } : {}),
    ...(caPem ? { caPem } : {}),
  };
}

export class CredentialCheckNotPassed extends Error {
  constructor(readonly check: CredentialCheck) {
    super(
      check.reason ??
        (check.status === "passed"
          ? "the credential expires within a day"
          : `the credential check ${check.status}`),
    );
  }
}

const KEY_CHECK_STATUS: Record<
  ProviderKeyCheck["result"],
  CredentialCheck["status"]
> = {
  ok: "passed",
  refused: "failed",
  unverified: "unchecked",
};

export function fromKeyCheck(keyCheck: ProviderKeyCheck): CredentialCheck {
  return {
    status: KEY_CHECK_STATUS[keyCheck.result],
    ...(keyCheck.detail ? { reason: keyCheck.detail } : {}),
    at: keyCheck.checkedAt,
  };
}

export function credentialCheckOf(
  conn: Connection,
): CredentialCheck | undefined {
  const parsed = credentialCheckSchema.safeParse(
    conn.inputs[CREDENTIAL_CHECK_INPUT_KEY],
  );
  if (parsed.success) return parsed.data;
  const keyCheck = keyCheckOf(conn);
  return keyCheck ? fromKeyCheck(keyCheck) : undefined;
}
