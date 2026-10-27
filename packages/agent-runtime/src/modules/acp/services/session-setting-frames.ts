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
 * picked none, and only for a harness whose manifest opts in: one that starts
 * on no mode of its own. A harness that does not opt in keeps its own sources
 * of a start mode — a thinking level, a pinned persona — so the runtime names
 * none. Where it does opt in, the catalog's default for the model the session
 * runs on applies, never a mode the agent's config file names: a permission
 * mode is tool approval, which is only ever a session's own pick.
 */
export function derivedMode(input: SessionSettingInput): string | null {
  const { settings, model, harness } = input;
  const mode = modeSettingOf(harness);
  if (mode === undefined || !mode.derive || settings[mode.id] !== undefined)
    return null;
  return startModeFor(
    harness?.catalog,
    model ?? harness?.configured().model ?? null,
    mode.id,
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the frames that carry one session's settings
 * into its harness: the session's model, its mode, and every config option it
 * picked. A mode the session picked is the session's and is sent as it is. A
 * session that picked none gets the mode `derivedMode` picks, and none where it
 * picks none, since the harness is on its own start mode already. The model
 * comes first, and the settings are sent one at a time, because a harness reads
 * its mode against the model it holds.
 */
export function sessionSettingFrames(
  input: SessionSettingInput,
): SessionSettingFrame[] {
  const { sessionId, settings, model, native, harness } = input;
  const modeId = modeSettingOf(harness)?.id;
  const chosen = modeId === undefined ? undefined : settings[modeId];
  const derived = chosen === undefined ? derivedMode(input) : null;
  const mode = chosen ?? derived ?? undefined;
  return [
    ...modelFrames(harness, sessionId, model, native),
    ...(modeId !== undefined && mode !== undefined
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
): { id: string; derive: boolean } | undefined {
  const found = Object.entries(harness?.sessionSettings ?? {}).find(
    ([, binding]) => "mode" in binding,
  );
  if (found === undefined) return undefined;
  const [id, binding] = found;
  return {
    id,
    derive: "mode" in binding && binding.deriveStartMode === true,
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
