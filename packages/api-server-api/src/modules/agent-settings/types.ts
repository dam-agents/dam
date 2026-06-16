/** An agent's persistent harness session defaults, mirroring the ACP config
 *  shape: `model` is a modelId, `mode` is a modeId, and `configOptions` maps an
 *  ACP configId (e.g. the `thought_level` option) to its select value or
 *  boolean. `null` model/mode mean "no default, use the harness's own"; a
 *  harness that doesn't expose an axis leaves it null/empty. */
export interface AgentSettings {
  model: string | null;
  mode: string | null;
  configOptions: Record<string, string | boolean>;
}

export type AgentSettingsInput = AgentSettings;

/** What `get` returns: the saved defaults plus whether this agent's harness can
 *  actually honor a persistent default (it advertises the `harness-config`
 *  contribution). The UI hides the section when `supported` is false so it
 *  never offers a default the harness would silently drop. */
export interface AgentSettingsView extends AgentSettings {
  supported: boolean;
}

export interface AgentSettingsService {
  get(agentId: string): Promise<AgentSettingsView>;
  set(agentId: string, input: AgentSettingsInput): Promise<AgentSettings>;
}
