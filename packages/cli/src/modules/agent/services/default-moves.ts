import {
  aliasForTemplateId,
  parseQualifiedModel,
  type ConnectionView,
  type DefaultKind,
  type SessionDefaults,
  type SessionPair,
} from "api-server-api";
import type { AgentModelsService } from "./agent-models-service.js";

export interface DefaultMove {
  kind: DefaultKind;
  model: string | null;
  from: string;
  to: string | null;
  reason?: string;
}

const KINDS: readonly DefaultKind[] = ["chat", "channel", "scheduled"];

const sameModel = (a: string, b: string): boolean => {
  const x = parseQualifiedModel(a, { claudePrefix: true });
  const y = parseQualifiedModel(b, { claudePrefix: true });
  return (
    x !== null &&
    y !== null &&
    x.alias === y.alias &&
    x.upstreamId.toLowerCase() === y.upstreamId.toLowerCase()
  );
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: revoking a provider changes only the agent's
 * grants, so a saved default (chat, channel or scheduled) that names the
 * revoked Connection keeps naming it. Each such default moves to a provider
 * still granted with the same alias that offers its model; one that has not
 * listed its models yet counts, and the server refuses the move when the
 * harness cannot run it. Each move is reported from
 * the defaults read back after it, and one with nowhere to go has `to: null`,
 * for the caller to warn about.
 */
export async function moveDefaultsOffRevoked(
  svc: AgentModelsService,
  agentId: string,
  input: {
    before: SessionDefaults;
    revoked: ReadonlySet<string>;
    connections: readonly ConnectionView[];
    skip: ReadonlySet<DefaultKind>;
  },
): Promise<DefaultMove[]> {
  const stranded = KINDS.flatMap((kind) => {
    const pair = input.before[kind];
    return pair?.provider &&
      input.revoked.has(pair.provider) &&
      !input.skip.has(kind)
      ? [{ kind, pair, from: pair.provider }]
      : [];
  });
  if (stranded.length === 0) return [];
  const held = (pair: SessionPair | null | undefined): string | null =>
    pair?.provider && !input.revoked.has(pair.provider) ? pair.provider : null;

  const [after, granted] = await Promise.all([
    svc.savedDefaults(agentId),
    svc.grantedConnectionIds(agentId),
  ]);
  const unread = !after.ok ? after.error : !granted.ok ? granted.error : null;
  if (!after.ok || !granted.ok)
    return stranded.map(({ kind, pair, from }) => ({
      kind,
      model: pair.model,
      from,
      to: null,
      reason: `could not read the agent's defaults: ${unread?.reason}`,
    }));

  const refused = new Map<DefaultKind, string>();
  for (const { kind, pair, from } of stranded) {
    if (held(after.value[kind]) !== null) continue;
    const alias =
      aliasForTemplateId(
        input.connections.find((c) => c.id === from)?.templateId ?? "",
      ) ?? parseQualifiedModel(pair.model, { claudePrefix: true })?.alias;
    const found = alias
      ? await replacementFor(svc, agentId, pair, alias, granted.value)
      : { to: null };
    if (found.to === null) {
      if (found.reason) refused.set(kind, found.reason);
      continue;
    }
    const to = found.to;
    const saved = await svc.rememberDefault(agentId, kind, {
      ...pair,
      provider: to,
    });
    if (!saved.ok) refused.set(kind, saved.error.reason);
  }

  const final = await svc.savedDefaults(agentId);
  return stranded.map(({ kind, pair, from }) => {
    const to = final.ok ? held(final.value[kind]) : null;
    const reason =
      refused.get(kind) ??
      (final.ok
        ? undefined
        : `could not read the agent's defaults: ${final.error.reason}`);
    return {
      kind,
      model: pair.model,
      from,
      to,
      ...(to === null && reason !== undefined && { reason }),
    };
  });
}

async function replacementFor(
  svc: AgentModelsService,
  agentId: string,
  pair: SessionPair,
  alias: string,
  granted: readonly string[],
): Promise<{ to: string | null; reason?: string }> {
  const catalog = await svc.catalog(agentId, pair.harness);
  if (!catalog.ok)
    return {
      to: null,
      reason: `could not read the agent's models: ${catalog.error.reason}`,
    };
  const model = pair.model;
  return {
    to:
      catalog.value.providers.find(
        (p) =>
          granted.includes(p.connectionId) &&
          p.alias === alias &&
          p.status !== "unsupported" &&
          (model === null ||
            p.status !== "listed" ||
            p.models.some((m) => sameModel(m.name, model))),
      )?.connectionId ?? null,
  };
}
