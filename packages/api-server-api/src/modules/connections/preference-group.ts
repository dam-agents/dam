import type { Contribution } from "agent-runtime-api";
import { awsProfileKind } from "./aws-profiles.js";
import {
  defaultAccountGroupKey,
  defaultAccountGroups,
  type DefaultAccountGroup,
  type DefaultAccountSource,
} from "./default-accounts.js";
import { githubAccountKind } from "./github-accounts.js";

export const DEFAULT_ACCOUNT_KINDS = [githubAccountKind, awsProfileKind];

export type DefaultAccountKindId =
  (typeof DEFAULT_ACCOUNT_KINDS)[number]["id"];

export function preferenceGroupOf(
  contributions: readonly Contribution[],
): string | undefined {
  for (const kind of DEFAULT_ACCOUNT_KINDS) {
    const scope = kind.scopeOf(contributions);
    if (scope !== undefined) return defaultAccountGroupKey(kind.id, scope);
  }
  return undefined;
}

export function contestedDefaultAccounts(
  granted: readonly DefaultAccountSource[],
): DefaultAccountGroup<DefaultAccountKindId>[] {
  return DEFAULT_ACCOUNT_KINDS.flatMap((kind) =>
    defaultAccountGroups<DefaultAccountKindId>(kind, granted),
  ).filter((group) => group.accounts.length > 1);
}
