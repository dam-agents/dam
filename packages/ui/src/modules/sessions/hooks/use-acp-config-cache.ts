import type {
  ClientSideConnection,
  SessionConfigOption,
} from "@agentclientprotocol/sdk/dist/acp.js";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import { useCallback, useEffect } from "react";

import { useStore } from "../../../store.js";
import { openConnection } from "../../acp/acp.js";
import {
  type AcpUpdate,
  type SessionConfigPayload,
  sessionConfigPayloadSchema,
} from "../../acp/types.js";
import {
  flattenSelectOptions,
  getSavedPreferences,
} from "../components/session-config-popover.js";

const cachedConfigKey = (agentId: string) =>
  `platform-cached-config:${agentId}`;

export interface AcpConfigCache {
  /** Persist a fresh session-config response into the store + localStorage. */
  captureSessionConfig: (response: SessionConfigPayload) => void;
  /** Apply incremental ACP `current_mode_update` / `config_option_update`
   *  notifications to the store. */
  handleConfigUpdate: (update: AcpUpdate) => void;
  /** Replay the user's saved per-agent preferences into a freshly-created
   *  session — sets model/mode and forwards each config option. */
  applySavedPreferences: (
    conn: ClientSideConnection,
    sid: string,
    sessionResponse: SessionConfigPayload,
  ) => Promise<void>;
}

/**
 * Owns the per-agent config cache: store mirror, localStorage persistence,
 * and the throwaway-session bootstrap that hydrates the cache when a fresh
 * UI loads on a running agent with no live session yet.
 *
 * Returns three callbacks the orchestrator weaves into the connection
 * lifecycle: `captureSessionConfig` after newSession/loadSession,
 * `handleConfigUpdate` from the streaming handler, and `applySavedPreferences`
 * once a new session is up.
 */
export function useAcpConfigCache(
  selectedAgent: string | null,
  sessionId: string | null,
  agentOperable: boolean,
): AcpConfigCache {
  const setSessionModes = useStore((s) => s.setSessionModes);
  const setSessionModels = useStore((s) => s.setSessionModels);
  const setSessionConfigOptions = useStore((s) => s.setSessionConfigOptions);

  const captureSessionConfig = useCallback(
    (response: SessionConfigPayload) => {
      setSessionModes(response.modes ?? null);
      setSessionModels(response.models ?? null);
      setSessionConfigOptions(response.configOptions ?? []);
      if (selectedAgent) {
        try {
          localStorage.setItem(
            cachedConfigKey(selectedAgent),
            JSON.stringify({
              modes: response.modes ?? null,
              models: response.models ?? null,
              configOptions: response.configOptions ?? [],
            }),
          );
        } catch {}
      }
    },
    [selectedAgent, setSessionModes, setSessionModels, setSessionConfigOptions],
  );

  const handleConfigUpdate = useCallback(
    (update: AcpUpdate) => {
      if (update.sessionUpdate === "current_mode_update") {
        const { currentModeId } = update;
        const modes = useStore.getState().sessionModes;
        if (modes) setSessionModes({ ...modes, currentModeId });
      } else if (update.sessionUpdate === "config_option_update") {
        setSessionConfigOptions(update.configOptions);
      }
    },
    [setSessionModes, setSessionConfigOptions],
  );

  const applySavedPreferences = useCallback(
    async (
      conn: ClientSideConnection,
      sid: string,
      sessionResponse: SessionConfigPayload,
    ) => {
      if (!selectedAgent) return;
      const prefs = getSavedPreferences(selectedAgent);
      const calls: Promise<unknown>[] = [];
      if (
        prefs.model &&
        sessionResponse.models?.availableModels.some(
          (m) => m.modelId === prefs.model,
        )
      ) {
        calls.push(
          conn
            .unstable_setSessionModel({ sessionId: sid, modelId: prefs.model })
            .catch(() => {}),
        );
        setSessionModels({
          ...sessionResponse.models,
          currentModelId: prefs.model,
        });
      }
      // Newer adapters expose the model as a `category: "model"` config
      // option instead of the legacy session-model state — forward the saved
      // model preference through that channel (unless the config loop below
      // already carries a value for it).
      if (prefs.model && !sessionResponse.models) {
        const modelOpt = sessionResponse.configOptions?.find(
          (o): o is Extract<SessionConfigOption, { type: "select" }> =>
            o.category === "model" && o.type === "select",
        );
        if (
          modelOpt &&
          prefs.config[modelOpt.id] === undefined &&
          flattenSelectOptions(modelOpt.options).some(
            (o) => o.value === prefs.model,
          )
        ) {
          calls.push(
            conn
              .setSessionConfigOption({
                sessionId: sid,
                configId: modelOpt.id,
                value: prefs.model,
              })
              .catch(() => {}),
          );
        }
      }
      if (
        prefs.mode &&
        sessionResponse.modes?.availableModes.some((m) => m.id === prefs.mode)
      ) {
        calls.push(
          conn
            .setSessionMode({ sessionId: sid, modeId: prefs.mode })
            .catch(() => {}),
        );
        setSessionModes({
          ...sessionResponse.modes,
          currentModeId: prefs.mode,
        });
      }
      for (const [configId, value] of Object.entries(prefs.config)) {
        const opt = sessionResponse.configOptions?.find(
          (o) => o.id === configId,
        );
        if (!opt) continue;
        const req =
          opt.type === "boolean"
            ? {
                sessionId: sid,
                configId,
                type: "boolean" as const,
                value: value === "true",
              }
            : { sessionId: sid, configId, value };
        calls.push(conn.setSessionConfigOption(req).catch(() => {}));
      }
      if (calls.length) await Promise.all(calls);
    },
    [selectedAgent, setSessionModes, setSessionModels],
  );

  // Hydrate from localStorage cache, or fetch via a throwaway session if the
  // cache is empty and the agent is running. Skipped while a real session
  // is active — that path captures config via captureSessionConfig.
  useEffect(() => {
    if (!selectedAgent || sessionId) return;
    const prefs = getSavedPreferences(selectedAgent);

    const applyConfig = (data: SessionConfigPayload) => {
      if (data.modes) {
        const modes = { ...data.modes };
        if (
          prefs.mode &&
          modes.availableModes?.some((m) => m.id === prefs.mode)
        )
          modes.currentModeId = prefs.mode;
        setSessionModes(modes);
      }
      if (data.models) {
        const models = { ...data.models };
        if (
          prefs.model &&
          models.availableModels?.some((m) => m.modelId === prefs.model)
        )
          models.currentModelId = prefs.model;
        setSessionModels(models);
      }
      if (data.configOptions?.length)
        setSessionConfigOptions(data.configOptions);
    };

    try {
      const raw = localStorage.getItem(cachedConfigKey(selectedAgent));
      if (raw) {
        const parsed = sessionConfigPayloadSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          applyConfig(parsed.data);
          return;
        }
        console.warn(
          "[acp-config-cache] schema mismatch on cached session config, will refetch:",
          parsed.error.issues,
        );
      }
    } catch (err) {
      console.warn(
        "[acp-config-cache] could not JSON.parse cached session config, will refetch:",
        err,
      );
    }

    if (!agentOperable) return;
    let cancelled = false;

    (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const { connection, ws } = await openConnection(
            selectedAgent,
            () => {},
          );
          if (cancelled) {
            ws.close();
            return;
          }
          await connection.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
            },
          });
          const s = await connection.newSession({ cwd: ".", mcpServers: [] });
          try {
            await connection.unstable_closeSession?.({
              sessionId: s.sessionId,
            });
          } catch {}
          ws.close();
          if (cancelled) return;
          const data = {
            modes: s.modes,
            models: s.models,
            configOptions: s.configOptions,
          };
          try {
            localStorage.setItem(
              cachedConfigKey(selectedAgent),
              JSON.stringify(data),
            );
          } catch {}
          applyConfig(data);
          return;
        } catch {
          if (!cancelled) await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    selectedAgent,
    sessionId,
    agentOperable,
    setSessionModes,
    setSessionModels,
    setSessionConfigOptions,
  ]);

  return { captureSessionConfig, handleConfigUpdate, applySavedPreferences };
}
