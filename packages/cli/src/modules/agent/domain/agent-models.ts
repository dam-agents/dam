import type { HarnessCatalogView } from "agent-runtime-api";
import {
  aliasForTemplateId,
  formatQualifiedModel,
  PROVIDER_TEMPLATE_IDS,
  parseQualifiedModel,
  type ConnectionView,
  type DefaultKind,
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
  defaults: SessionDefaults | null;
  unreadable: Partial<Record<"providers" | "harnesses" | "defaults", string>>;
}

export function isModelProvider(connection: ConnectionView): boolean {
  return PROVIDER_TEMPLATE_IDS.has(connection.templateId);
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

const unreadable = (reason: string): string => `<could not read: ${reason}>`;

function renderProviders(view: AgentModelsView): string {
  if (view.unreadable.providers) return unreadable(view.unreadable.providers);
  if (view.providers === null || view.providers.length === 0) return "<none>";
  return view.providers.map((p) => `${p.name} (${p.alias})`).join(", ");
}

function renderHarnesses(view: AgentModelsView): string {
  if (view.unreadable.harnesses) return unreadable(view.unreadable.harnesses);
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

function renderDefault(view: AgentModelsView, kind: DefaultKind): string {
  if (view.unreadable.defaults || view.defaults === null)
    return unreadable(view.unreadable.defaults ?? "unknown");
  const own = view.defaults[kind];
  return kind !== "chat" && own === null
    ? "same as chat"
    : renderPair(own, view.providers);
}

export function modelEntries(view: AgentModelsView): [string, string][] {
  return [
    ["PROVIDERS", renderProviders(view)],
    ["HARNESSES", renderHarnesses(view)],
    ["DEFAULT", renderDefault(view, "chat")],
    ["CHANNEL DEFAULT", renderDefault(view, "channel")],
    ["SCHEDULED DEFAULT", renderDefault(view, "scheduled")],
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code's catalog spells a model
 * `claude/<alias>/<id>`, lowercased, because its gateway discovery keeps only
 * ids containing `claude`. That prefix is routing, so the CLI shows the
 * Qualified Model Name a saved default and `--model` use; the server folds
 * the prefixed form too, so either one works as `--model`.
 */
export function withQualifiedNames(
  catalog: HarnessCatalogView,
): HarnessCatalogView {
  return {
    ...catalog,
    providers: catalog.providers.map((p) => ({
      ...p,
      models: p.models.map((m) => {
        const parsed = parseQualifiedModel(m.name, { claudePrefix: true });
        return parsed
          ? {
              ...m,
              name: formatQualifiedModel(parsed.alias, parsed.upstreamId),
            }
          : m;
      }),
    })),
  };
}
