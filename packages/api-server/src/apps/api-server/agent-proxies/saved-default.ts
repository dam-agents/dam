import type { FirePair } from "../../../modules/harness-config/index.js";
import { isNoDefaultModelError } from "../../../modules/harness-config/index.js";

type Platform = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const named = (platform: Platform, key: string): string | undefined => {
  const v = platform[key];
  return typeof v === "string" && v !== "" ? v : undefined;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: a client that starts a Session through the ACP
 * relay without naming a model, such as `dam run`, a script or an older CLI,
 * gets the agent's chat default filled in: the same Session Pair the web
 * chat sends, and with no harness named the session follows that default as
 * a web chat does. Without it, the runtime refuses the
 * session as having no model on a harness that reaches its models through
 * the Model Router. Null when the frame is not a `session/new` without a
 * model, so it is passed on as it is. The promise gives null when there is
 * nothing to fill in: no chat default model for the harness the frame
 * names, or a runtime that does not route Session Pairs. Then the runtime's
 * own `no-model` refusal tells the client what to set.
 */
export function fillSavedDefault(
  frame: unknown,
  agentId: string,
  firePair: FirePair,
): Promise<object | null> | null {
  if (!isObject(frame) || frame.method !== "session/new") return null;
  if (frame.id === undefined) return null;
  const params = isObject(frame.params) ? frame.params : {};
  const meta = isObject(params._meta) ? params._meta : {};
  const platform: Platform = isObject(meta.platform) ? meta.platform : {};
  if (named(platform, "model") !== undefined) return null;
  const harness = named(platform, "harness");
  const provider = named(platform, "provider");
  return firePair(agentId, "chat", {
    ...(harness !== undefined && { harness }),
    ...(provider !== undefined && { provider }),
  }).then(
    (pair) => {
      if (!pair?.model) return null;
      return {
        ...frame,
        params: {
          ...params,
          _meta: {
            ...meta,
            platform: {
              ...(harness === undefined &&
                platform.follows === undefined && { follows: "chat" }),
              ...platform,
              harness: pair.harness,
              ...(pair.provider !== null && { provider: pair.provider }),
              model: pair.model,
              ...(pair.settings &&
                platform.settings === undefined && {
                  settings: pair.settings,
                }),
            },
          },
        },
      };
    },
    (err: unknown) => {
      if (isNoDefaultModelError(err)) return null;
      throw err;
    },
  );
}
