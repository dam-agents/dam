import {
  aliasForTemplateId,
  parseQualifiedModel,
  type ConnectionView,
  type ProviderAlias,
  type SessionDefaults,
  type SessionPair,
} from "api-server-api";

export interface ModelProviderView {
  id: string;
  name: string;
  alias: ProviderAlias;
}

export interface AgentModelsView {
  providers: ModelProviderView[] | null;
  harnesses: string[] | null;
  defaultHarness: string | null;
  defaults: SessionDefaults;
}

export function modelProviders(
  connections: readonly ConnectionView[],
  grantedIds: readonly string[],
): ModelProviderView[] {
  return connections.flatMap((c) => {
    const alias = aliasForTemplateId(c.templateId);
    return alias !== null && grantedIds.includes(c.id)
      ? [{ id: c.id, name: c.name, alias }]
      : [];
  });
}

function renderProviders(
  providers: readonly ModelProviderView[] | null,
): string {
  if (providers === null) return "<unknown: needs credentials:read>";
  if (providers.length === 0) return "<none>";
  return providers.map((p) => `${p.name} (${p.alias})`).join(", ");
}

function renderHarnesses(view: AgentModelsView): string {
  if (view.harnesses === null) return "<unknown until the agent first runs>";
  return view.harnesses
    .map((h) => (h === view.defaultHarness ? `${h} (default)` : h))
    .join(", ");
}

function renderPair(
  pair: SessionPair | null,
  providers: readonly ModelProviderView[] | null,
): string {
  if (pair === null || pair.model === null)
    return `not set${pair ? ` (harness ${pair.harness})` : ""}`;
  const settings = Object.entries(pair.settings ?? {})
    .map(([id, value]) => `${id}=${value}`)
    .join(", ");
  const alias = parseQualifiedModel(pair.model, { claudePrefix: true })?.alias;
  const ungranted =
    providers !== null &&
    alias !== undefined &&
    !providers.some((p) => p.alias === alias);
  return (
    `${pair.model} on ${pair.harness}` +
    (settings ? ` (${settings})` : "") +
    (ungranted ? ` — no ${alias} provider is granted, so runs fail` : "")
  );
}

function renderKindDefault(
  view: AgentModelsView,
  kind: "channel" | "scheduled",
): string {
  const own = view.defaults[kind];
  return own === null ? "same as chat" : renderPair(own, view.providers);
}

export function modelEntries(view: AgentModelsView): [string, string][] {
  return [
    ["PROVIDERS", renderProviders(view.providers)],
    ["HARNESSES", renderHarnesses(view)],
    ["DEFAULT", renderPair(view.defaults.chat, view.providers)],
    ["CHANNEL DEFAULT", renderKindDefault(view, "channel")],
    ["SCHEDULED DEFAULT", renderKindDefault(view, "scheduled")],
  ];
}

export function renderEntries(entries: readonly [string, string][]): string {
  const pad = Math.max(...entries.map(([k]) => k.length)) + 2;
  return (
    entries
      .map(([k, v]) => `${k}:${" ".repeat(pad - k.length)}${v}`)
      .join("\n") + "\n"
  );
}
