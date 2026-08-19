export interface RosterEntry {
  instanceName: string;
  name: string;
  owner: string;
  ambient: boolean;
  isDefault: boolean;
}

export interface RoutedMention {
  target: RosterEntry;
  addressedByName: boolean;
  ambiguousName: string | null;
}

const LEADING_MENTIONS = /^(?:\s*<@[^>]+>)+\s*/;

const NAME_TERMINATOR = /^[\s:,;.!?—-]/;

export function stripLeadingMentions(text: string): string {
  return text.replace(LEADING_MENTIONS, "");
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function startsWithName(body: string, name: string): boolean {
  if (!name) return false;
  if (!body.startsWith(name)) return false;
  const rest = body.slice(name.length);
  return rest.length === 0 || NAME_TERMINATOR.test(rest);
}

export function defaultOf(roster: RosterEntry[]): RosterEntry | null {
  return roster.find((entry) => entry.isDefault) ?? roster[0] ?? null;
}

export function orderAmbientReaders(
  readers: RosterEntry[],
  rng: () => number = Math.random,
): RosterEntry[] {
  const primary = readers.filter((entry) => entry.isDefault);
  const rest = readers.filter((entry) => !entry.isDefault);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [...primary, ...rest];
}

export function matchRosterName(
  roster: RosterEntry[],
  candidate: string,
): { matches: RosterEntry[]; name: string } {
  const wanted = normalize(candidate);
  const matches = roster.filter(
    (entry) => normalize(entry.name) === wanted && wanted.length > 0,
  );
  return { matches, name: wanted };
}

export function routeMention(
  text: string,
  roster: RosterEntry[],
): RoutedMention | null {
  const fallback = defaultOf(roster);
  if (!fallback) return null;

  const body = normalize(stripLeadingMentions(text));
  const named = roster.filter((entry) =>
    startsWithName(body, normalize(entry.name)),
  );

  if (named.length === 0)
    return { target: fallback, addressedByName: false, ambiguousName: null };

  const longest = named.reduce((a, b) =>
    normalize(b.name).length > normalize(a.name).length ? b : a,
  );
  const tied = named.filter(
    (entry) => normalize(entry.name).length === normalize(longest.name).length,
  );

  if (tied.length > 1)
    return {
      target: fallback,
      addressedByName: false,
      ambiguousName: longest.name,
    };

  return { target: longest, addressedByName: true, ambiguousName: null };
}
