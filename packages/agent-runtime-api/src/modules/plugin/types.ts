import type { Contribution } from "../runtime/types.js";

export const PLUGIN_PROTOCOL_VERSION = 1 as const;
export type PluginProtocolVersion = typeof PLUGIN_PROTOCOL_VERSION;

export interface DispatchContext {
  readonly agentHome: string;
  readonly pluginStateDir: string;
  log(msg: string): void;
}

export type KindHandler = (
  contributions: Contribution[],
  ctx: DispatchContext,
) => Promise<void>;

export type DriverBinding = Readonly<{ impl: string }> &
  Readonly<Record<string, unknown>>;

export interface Plugin {
  readonly name: string;
  bind(kind: string, binding: DriverBinding): KindHandler;
}

export interface PluginModule {
  readonly pluginProtocolVersion: PluginProtocolVersion;
  createPlugin(): Plugin;
}
