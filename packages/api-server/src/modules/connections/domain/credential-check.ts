import {
  credentialCheckSchema,
  type Connection,
  type CredentialCheck,
  type ProviderKeyCheck,
} from "api-server-api";
import { keyCheckOf } from "./provider-key-check.js";

export const CREDENTIAL_CHECK_INPUT_KEY = "credentialCheck";

export type CredentialCheckKind = "github-user";

export type CredentialProbeOutcome = Omit<CredentialCheck, "at">;

export interface CredentialProbe {
  probe(
    kind: CredentialCheckKind,
    host: string,
    value: string,
  ): Promise<CredentialProbeOutcome>;
}

export class CredentialCheckNotPassed extends Error {
  constructor(readonly check: CredentialCheck) {
    super(check.reason ?? `the credential check ${check.status}`);
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
