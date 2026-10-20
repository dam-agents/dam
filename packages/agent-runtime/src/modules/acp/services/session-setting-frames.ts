import { parseQualifiedModel } from "api-server-api";
import { startModeFor, type HarnessConfigCatalog } from "agent-runtime-api";
import type { SessionSettingBinding } from "../../runtime-channel/manifest.js";
import type { SessionSettingFrame } from "./acp-runtime/acp-runtime.js";

export interface SessionHarness {
  catalog?: HarnessConfigCatalog;
  sessionSettings?: Record<string, SessionSettingBinding>;
  sessionModelFrame?: {
    configOption: string;
    render: (model: string) => string;
  };
  configuredMode?: () => string | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the frames that carry one session's settings
 * into its harness: the session's model, its mode, and every config option it
 * picked. A mode the session picked is the session's and is sent as it is. A
 * session that picked none starts on the mode the harness's own config file
 * names, which the harness reads itself, and only where that file names none
 * is the mode derived from the catalog and the session's model — marked
 * `derived`, so a model switch derives it again instead of keeping a value
 * the new model may not allow.
 */
export function sessionSettingFrames(input: {
  sessionId: string;
  settings: Record<string, string>;
  model: string | null;
  native: boolean;
  harness?: SessionHarness;
}): SessionSettingFrame[] {
  const { sessionId, settings, model, native, harness } = input;
  const modeId = modeSettingIdOf(harness);
  const chosen = modeId === undefined ? undefined : settings[modeId];
  const mode =
    modeId === undefined
      ? null
      : (chosen ??
        (harness?.configuredMode?.()
          ? null
          : startModeFor(harness?.catalog, model, modeId)));
  return [
    ...modelFrames(harness, sessionId, model, native),
    ...(modeId !== undefined && mode !== null
      ? [
          {
            method: "session/set_mode",
            params: { sessionId, modeId: mode },
            ...(chosen === undefined && { derived: true }),
          },
        ]
      : []),
    ...Object.entries(settings).flatMap(
      ([id, value]): SessionSettingFrame[] => {
        const binding = harness?.sessionSettings?.[id];
        if (id === modeId || !binding || !("configOption" in binding))
          return [];
        return [
          {
            method: "session/set_config_option",
            params: { sessionId, configId: binding.configOption, value },
          },
        ];
      },
    ),
  ];
}

export function modeSettingIdOf(harness: SessionHarness | undefined) {
  return Object.entries(harness?.sessionSettings ?? {}).find(
    ([, binding]) => "mode" in binding,
  )?.[0];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the name is rendered the way the harness sees
 * the catalog; a native process gets the harness's own name, the part after
 * the Connection's alias. Critical, so a refusal answers the session's
 * prompts rather than running them on a substitute.
 */
function modelFrames(
  harness: SessionHarness | undefined,
  sessionId: string,
  model: string | null,
  native: boolean,
): SessionSettingFrame[] {
  const binding = harness?.sessionModelFrame;
  if (!binding || model === null) return [];
  const value = native
    ? (parseQualifiedModel(model)?.upstreamId ?? model)
    : binding.render(model);
  return [
    {
      method: "session/set_config_option",
      params: {
        sessionId,
        configId: binding.configOption,
        value,
      },
      critical: true,
    },
  ];
}
