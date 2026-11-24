import { aliasForTemplateId, HARNESS_HOME_PROVIDERS } from "api-server-api";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the settings of a harness's home Connection that
 * its processes read from their env: the names the manifest declares in
 * `connectionEnv` (Bob's Advanced settings: model, mode, cost cap, team and
 * instance), taken from the Connection whose alias is the harness's home, the
 * home aliases tried in the harness's own order. A routed Connection's layer
 * otherwise stays out of the process, where the router's own variables stand
 * for it, and another Connection that carries one of the names for its own
 * redirect (the LiteLLM preset's Bob model) contributes nothing. The spawn env
 * lays the result under every other layer, so the agent's own env and the
 * router's variables outrank it.
 */
export function homeConnectionEnv(input: {
  harness: string;
  binding: ModelRouterBinding | undefined;
  layers: readonly { template?: string; env: Record<string, string> }[];
}): Record<string, string> {
  const names = input.binding?.connectionEnv;
  if (names === undefined) return {};
  for (const alias of HARNESS_HOME_PROVIDERS[input.harness] ?? []) {
    const layer = input.layers.find(
      (l) =>
        l.template !== undefined && aliasForTemplateId(l.template) === alias,
    );
    if (layer === undefined) continue;
    return Object.fromEntries(
      names.flatMap((name) => {
        const value = layer.env[name];
        return value === undefined ? [] : [[name, value] as const];
      }),
    );
  }
  return {};
}
