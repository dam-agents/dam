import { aliasForProviderType, preferredModelOf } from "api-server-api";
import type { CatalogProvider } from "../../model-catalog/index.js";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";

const SECURITY_MODEL = "security";

/**
 * UNIT_BOUNDARY_DESCRIPTION: before a shell command Bob asks the router for a
 * model named `security`, its command-safety check, and a listing that has no
 * such model makes Bob record the check as unverified and ask the user before
 * every command, whatever its approvals posture. Only Bob Shell's gateway lists
 * that name, so on any other provider the check runs on CurveBender's preferred
 * classifier, the Nemotron the platform already names for a classifier there,
 * and a CurveBender-only agent stays able to run commands unattended. Bob is the
 * harness whose manifest carries the gateway, and its other models, and another
 * harness asking for `security`, are not this call and keep their refusal. Null
 * when the call is not Bob's, when CurveBender is not granted, or when its
 * listing holds no such model, which leaves the refusal as it was; a refused or
 * failed stand-in call still reaches Bob as an error, and Bob asks.
 */
export function bobSecurityStandIn(input: {
  binding: ModelRouterBinding | undefined;
  model: string;
  providers: readonly CatalogProvider[];
}): string | null {
  if (input.binding?.bobGateway !== true || input.model !== SECURITY_MODEL)
    return null;
  const curveBender = input.providers.find(
    (p) => p.alias === aliasForProviderType("curve-bender"),
  );
  const pick = curveBender
    ? preferredModelOf("classifier", [
        {
          alias: curveBender.alias,
          listed: curveBender.entries.map((e) => e.upstreamId),
        },
      ])
    : null;
  return pick ? `${pick.alias}/${pick.upstreamId}` : null;
}
