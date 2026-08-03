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

/** Handles one one-shot event. Payload is `unknown` at the boundary, narrowed by the impl. */
export type EventHandler = (
  payload: unknown,
  ctx: DispatchContext,
) => Promise<void>;

export type DriverBinding = Readonly<{ impl: string }> &
  Readonly<Record<string, unknown>>;

/** Handles contribution kinds (`bind`), event kinds (`bindEvent`), or both; at least one must be present. */
export interface Plugin {
  readonly name: string;
  bind?(kind: string, binding: DriverBinding): KindHandler;
  bindEvent?(kind: string, binding: DriverBinding): EventHandler;
}

export interface PluginModule {
  readonly pluginProtocolVersion: PluginProtocolVersion;
  createPlugin(): Plugin;
}
