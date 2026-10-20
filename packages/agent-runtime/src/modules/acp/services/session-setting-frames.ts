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
  configured: () => { mode: string | null; model: string | null };
  env?: Record<string, string>;
}

export interface SessionSettingInput {
  sessionId: string;
  settings: Record<string, string>;
  model: string | null;
  native: boolean;
  harness?: SessionHarness;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the mode the runtime picks for a session that
 * picked none, or null when it picks none because the harness's own start
 * modes name one. Those are the mode its config file names, and the one an env
 * variable its manifest binds for the purpose names — both reach the harness at
 * start, so the session is on them before any frame arrives. Where both name
 * none, the catalog's default for the model the session runs on applies: its
 * own model, or the file's where the session names none.
 */
export function derivedMode(input: SessionSettingInput): string | null {
  const { settings, model, harness } = input;
  const mode = modeSettingOf(harness);
  if (mode === undefined || settings[mode.id] !== undefined) return null;
  const configured = harness?.configured();
  const pinned = mode.startModeEnv
    ? harness?.env?.[mode.startModeEnv]?.trim()
    : "";
  if (configured?.mode || pinned) return null;
  return startModeFor(
    harness?.catalog,
    model ?? configured?.model ?? null,
    mode.id,
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the frames that carry one session's settings
 * into its harness: the session's model, its mode, and every config option it
 * picked. A mode the session picked is the session's and is sent as it is. A
 * session that picked none gets the mode `derivedMode` picks, and none where it
 * picks none, since the harness is on its own start mode already.
 */
export function sessionSettingFrames(
  input: SessionSettingInput,
): SessionSettingFrame[] {
  const { sessionId, settings, model, native, harness } = input;
  const modeId = modeSettingOf(harness)?.id;
  const mode =
    modeId === undefined ? null : (settings[modeId] ?? derivedMode(input));
  return [
    ...modelFrames(harness, sessionId, model, native),
    ...(mode !== null
      ? [{ method: "session/set_mode", params: { sessionId, modeId: mode } }]
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

export function modeSettingOf(
  harness: SessionHarness | undefined,
): { id: string; startModeEnv?: string } | undefined {
  const found = Object.entries(harness?.sessionSettings ?? {}).find(
    ([, binding]) => "mode" in binding,
  );
  if (found === undefined) return undefined;
  const [id, binding] = found;
  return {
    id,
    ...("mode" in binding &&
      binding.startModeEnv !== undefined && {
        startModeEnv: binding.startModeEnv,
      }),
  };
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
