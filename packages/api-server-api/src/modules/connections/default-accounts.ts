import type { Contribution } from "agent-runtime-api";

export interface DefaultAccountSource {
  id: string;
  name: string;
  preferred: boolean;
  grantedAt?: string;
  contributions: Contribution[];
}

export interface DefaultAccountNaming {
  slug: (text: string) => string;
  fallback: string;
  reserved?: ReadonlySet<string>;
  idSuffixLength?: number;
}

export interface DefaultAccountKind<Id extends string = string> {
  id: Id;
  scopeOf: (contributions: readonly Contribution[]) => string | undefined;
  naming: DefaultAccountNaming;
  minAccounts: number;
}

export interface DefaultAccount {
  connectionId: string;
  connectionName: string;
  name: string;
  active: boolean;
  contributions: Contribution[];
}

export interface DefaultAccountGroup<Id extends string = string> {
  kind: Id;
  scope: string;
  key: string;
  accounts: DefaultAccount[];
}

export function defaultAccountGroupKey(kind: string, scope: string): string {
  return scope === "" ? kind : `${kind}:${scope}`;
}

function byGrantTime(a: DefaultAccountSource, b: DefaultAccountSource): number {
  if (a.grantedAt !== b.grantedAt) {
    if (a.grantedAt === undefined) return 1;
    if (b.grantedAt === undefined) return -1;
    return a.grantedAt < b.grantedAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function accountNames(
  naming: DefaultAccountNaming,
  members: readonly DefaultAccountSource[],
): string[] {
  const taken = new Set<string>();
  return members.map((member) => {
    const base = naming.slug(member.name) || naming.fallback;
    const idSuffix = naming.slug(member.id).slice(0, naming.idSuffixLength);
    const name =
      taken.has(base) || naming.reserved?.has(base)
        ? `${base}-${idSuffix}`
        : base;
    taken.add(name);
    return name;
  });
}

export function defaultAccountGroups<Id extends string>(
  kind: DefaultAccountKind<Id>,
  granted: readonly DefaultAccountSource[],
): DefaultAccountGroup<Id>[] {
  const byScope = new Map<string, DefaultAccountSource[]>();
  for (const source of granted) {
    const scope = kind.scopeOf(source.contributions);
    if (scope === undefined) continue;
    byScope.set(scope, [...(byScope.get(scope) ?? []), source]);
  }
  const groups: DefaultAccountGroup<Id>[] = [];
  for (const [scope, unordered] of byScope) {
    if (unordered.length < kind.minAccounts) continue;
    const members = [...unordered].sort(byGrantTime);
    const activeIndex = Math.max(
      0,
      members.findIndex((member) => member.preferred),
    );
    const names = accountNames(kind.naming, members);
    groups.push({
      kind: kind.id,
      scope,
      key: defaultAccountGroupKey(kind.id, scope),
      accounts: members.map((member, index) => ({
        connectionId: member.id,
        connectionName: member.name,
        name: names[index] ?? member.id,
        active: index === activeIndex,
        contributions: member.contributions,
      })),
    });
  }
  return groups;
}
