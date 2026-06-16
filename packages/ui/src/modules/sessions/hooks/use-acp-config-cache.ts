import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk/dist/acp.js";
import { useCallback, useEffect } from "react";

import { useStore } from "../../../store.js";
import { openConnection } from "../../acp/acp.js";
import {
  type AcpUpdate,
  type SessionConfigPayload,
  sessionConfigPayloadSchema,
} from "../../acp/types.js";

const cachedConfigKey = (agentId: string) =>
  `platform-cached-config:${agentId}`;

export interface AcpConfigCache {
  /** Persist a fresh session-config response into the store + localStorage. */
  captureSessionConfig: (response: SessionConfigPayload) => void;
  /** Apply incremental ACP `current_mode_update` / `config_option_update`
   *  notifications to the store. */
  handleConfigUpdate: (update: AcpUpdate) => void;
}

/**
 * Owns the per-agent config *catalog*: the store mirror of what options the
 * harness advertises (modes / models / config options), a localStorage cache of
 * that catalog, and the throwaway-session bootstrap that hydrates it when a
 * fresh UI loads on a running agent with no live session yet.
 *
 * It deliberately does NOT persist the user's chosen values. The per-session
 * picker applies choices to the live ACP session only; the persistent per-agent
 * default lives server-side (agent settings). What's cached here is just the
 * set of available options, so the Config panel and popover can render before a
 * session exists.
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

  // Hydrate the catalog from localStorage, or fetch via a throwaway session if
  // the cache is empty and the agent is running. Skipped while a real session
  // is active — that path captures config via captureSessionConfig.
  useEffect(() => {
    if (!selectedAgent || sessionId) return;

    const applyConfig = (data: SessionConfigPayload) => {
      if (data.modes) setSessionModes(data.modes);
      if (data.models) setSessionModels(data.models);
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

  return { captureSessionConfig, handleConfigUpdate };
}
