import type {
  FirePair,
  RunBoundary,
} from "../../../modules/harness-config/index.js";
import { isNoDefaultModelError } from "../../../modules/harness-config/index.js";
import { splitSubagent } from "../../../modules/harness-config/domain/session-pair.js";

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
 * gets the agent's chat default, or with nothing saved the automatic model,
 * filled in: the same Session Pair the web
 * chat sends, and with no harness named the session follows that default as
 * a web chat does. Without it, the runtime refuses the
 * session as having no model on a harness that reaches its models through
 * the Model Router. Null when the frame is not a `session/new` without a
 * model, so it is passed on as it is. The promise gives null when there is
 * nothing to fill in: no model to run on for the harness the frame names,
 * or a runtime that does not route Session Pairs. Then the runtime's own
 * `no-model` refusal tells the client what to set.
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

const settingsOf = (platform: Platform): Record<string, string> =>
  Object.fromEntries(
    Object.entries(platform.settings ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

/**
 * UNIT_BOUNDARY_DESCRIPTION: a `session/new` is a run, so the settings it
 * carries are the ones the one rule derives, against the pair it starts on:
 * a frame naming its model but not its harness or provider has them resolved
 * the way every other run boundary resolves them, so the frame that goes out
 * is the one a fully specified frame sends (D193B). Null when the frame has
 * nothing to derive, so it is passed on as it is.
 */
async function withRunSettings(
  frame: unknown,
  agentId: string,
  boundary: RunBoundary,
): Promise<object | null> {
  if (!isObject(frame) || frame.method !== "session/new") return null;
  const params = isObject(frame.params) ? frame.params : {};
  const meta = isObject(params._meta) ? params._meta : {};
  const platform: Platform = isObject(meta.platform) ? meta.platform : {};
  const model = named(platform, "model");
  if (model === undefined) return null;
  const settings = settingsOf(platform);
  if (splitSubagent(settings)[1] === null) return null;
  const harness = named(platform, "harness");
  const provider = named(platform, "provider");
  const resolved =
    harness === undefined || provider === undefined
      ? await boundary.resolve(agentId, "chat", {
          model,
          ...(harness !== undefined && { harness }),
          ...(provider !== undefined && { provider }),
        })
      : undefined;
  const pair = {
    harness: harness ?? resolved?.harness ?? "",
    provider: provider ?? resolved?.provider ?? null,
    model,
  };
  const derived = await boundary.settings(agentId, pair, settings);
  return {
    ...frame,
    params: {
      ...params,
      _meta: {
        ...meta,
        platform: {
          ...platform,
          ...(harness === undefined &&
            resolved && { harness: resolved.harness }),
          ...(provider === undefined &&
            resolved?.provider != null && { provider: resolved.provider }),
          settings: derived ?? settings,
        },
      },
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the api-server sends the runtime for a
 * `session/new`: the chat default filled in where the frame names no model,
 * and, either way, the settings a run takes with its native subagent keys
 * derived. Every other frame, a running session's settings change included,
 * is passed on as the client sent it, since only the client holds that
 * session's whole state. Null when the frame is passed on as it is.
 */
export function prepareRunFrame(
  frame: unknown,
  agentId: string,
  firePair: FirePair,
  boundary?: RunBoundary,
): Promise<object | null> | null {
  const prepare = (target: unknown): Promise<object | null> | null =>
    boundary && isObject(target)
      ? withRunSettings(target, agentId, boundary)
      : null;
  const filled = fillSavedDefault(frame, agentId, firePair);
  if (filled === null) return prepare(frame);
  return filled.then(async (frameOfRun) => {
    const target = frameOfRun ?? frame;
    const prepared = isObject(target) ? prepare(target) : null;
    return (await prepared) ?? frameOfRun;
  });
}
