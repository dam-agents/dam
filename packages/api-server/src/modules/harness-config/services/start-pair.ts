import { TRPCError } from "@trpc/server";
import {
  isPlatformSubagentSetting,
  platformSubagentSettingsError,
  sessionSettingsError,
  type SessionSettings,
} from "agent-runtime-api";
import {
  formatQualifiedModel,
  parseQualifiedModel,
  preferredModelOf,
  type OwnerModelCatalogView,
  type SessionPair,
} from "api-server-api";
import { runSubagentSettings } from "../domain/session-pair.js";

export interface StartPair {
  pick(harness: string, connectionId: string): Promise<string | null>;
  check(
    pair: { harness: string; model: string; settings?: SessionSettings },
    grantedConnectionIds: readonly string[],
  ): Promise<SessionPair>;
  save(agentId: string, pair: SessionPair): Promise<void>;
}

const refuse = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the chat default a create names, checked before
 * the Agent exists, so it is checked against what the owner's providers list
 * and the harness manifests the api-server ships, not against a runtime that
 * has not said hello: the model names one of the Connections the create
 * grants, that Connection runs the harness, it lists the model for that
 * harness once it has listed at all, and the harness keeps each setting. The
 * pair saved is the one a save from the Providers section would store, so the
 * first hello finds a default and leaves it as it is. A create that names
 * only its provider starts on the model the platform prefers for work on
 * that harness among those it lists, else the first; none while it has not
 * listed.
 */
export function createStartPair(deps: {
  ownerCatalog: () => Promise<OwnerModelCatalogView>;
  write: (agentId: string, pair: SessionPair) => Promise<boolean>;
}): StartPair {
  return {
    async pick(harness, connectionId) {
      const provider = (await deps.ownerCatalog()).providers.find(
        (p) => p.connectionId === connectionId,
      );
      if (provider?.status !== "listed") return null;
      const ids = provider.models
        .filter((m) => m.harnesses.includes(harness))
        .map((m) => m.upstreamId);
      const preferred = preferredModelOf(
        "work",
        [{ alias: provider.alias, listed: ids }],
        harness,
      );
      const upstreamId = preferred?.upstreamId ?? ids[0];
      return upstreamId === undefined
        ? null
        : formatQualifiedModel(provider.alias, upstreamId);
    },

    async check({ harness, model, settings }, grantedConnectionIds) {
      const qualified = parseQualifiedModel(model, { claudePrefix: true });
      if (!qualified)
        return refuse(
          `name the model with its provider, as <provider>/${model}`,
        );
      const view = await deps.ownerCatalog();
      const ofAlias = view.providers.filter(
        (p) =>
          grantedConnectionIds.includes(p.connectionId) &&
          p.alias === qualified.alias,
      );
      if (ofAlias.length === 0)
        return refuse(
          `the new agent holds no ${qualified.alias} provider; name one it runs ${model} on`,
        );
      const provider = ofAlias.find((p) => p.harnesses.includes(harness));
      if (!provider)
        return refuse(
          `the ${harness} harness cannot run on ${ofAlias[0]!.displayName}`,
        );
      const wanted = qualified.upstreamId.toLowerCase();
      const listed = provider.models.find(
        (m) =>
          m.harnesses.includes(harness) &&
          m.upstreamId.toLowerCase() === wanted,
      );
      if (provider.status === "listed" && !listed)
        return refuse(
          `${provider.displayName} lists no ${qualified.upstreamId} for the ${harness} harness`,
        );
      const pair: SessionPair = {
        harness,
        provider: provider.connectionId,
        model: formatQualifiedModel(
          qualified.alias,
          listed?.upstreamId ?? qualified.upstreamId,
        ),
        ...(settings &&
          Object.keys(settings).length > 0 && { settings: { ...settings } }),
      };
      if (pair.settings) {
        const capability = view.harnesses.find((h) => h.name === harness);
        const derived = runSubagentSettings(
          capability,
          view,
          pair,
          pair.settings,
        );
        const unsupported = Object.keys(derived).find(
          (id) =>
            !(isPlatformSubagentSetting(id)
              ? capability?.platformSubagentSettings
              : capability?.sessionSettings?.includes(id)),
        );
        const invalid = unsupported
          ? `the ${harness} harness cannot keep ${unsupported} as a default`
          : (sessionSettingsError(
              capability?.harnessConfigCatalog,
              derived,
              pair.model,
            ) ??
            platformSubagentSettingsError(
              derived,
              (h) =>
                view.harnesses.find((c) => c.name === h)?.harnessConfigCatalog,
            ));
        if (invalid) refuse(invalid);
      }
      return pair;
    },

    async save(agentId, pair) {
      if (!(await deps.write(agentId, pair)))
        throw new TRPCError({
          code: "CONFLICT",
          message: "the new agent already holds a chat default",
        });
    },
  };
}
