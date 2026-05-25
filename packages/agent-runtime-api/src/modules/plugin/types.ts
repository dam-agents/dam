import type { Contribution } from "../runtime/types.js";

/**
 * Public plugin port for the agent-runtime's runtime channel (ADR-052
 * §"Per-harness driver model"). Both built-in drivers and out-of-tree
 * extension drivers implement this exact shape.
 *
 * An extension is an ES module that lives in any npm package the agent
 * image depends on. The runtime channel resolves each
 * `extensions.impls[].module` declared in the manifest via dynamic
 * import, reads the module's `pluginProtocolVersion` against
 * {@link PLUGIN_PROTOCOL_VERSION}, calls the named export's
 * `createPlugin()`, and registers the returned Plugin in the dispatcher
 * registry. A mismatch (missing marker, wrong version, wrong export
 * shape) fails the agent boot loud.
 *
 * Version bumps on any breaking change to {@link Plugin},
 * {@link DispatchContext}, or {@link KindHandler}. Extension authors
 * pin to a compatible major; loaders refuse incompatible modules.
 */
export const PLUGIN_PROTOCOL_VERSION = 1 as const;
export type PluginProtocolVersion = typeof PLUGIN_PROTOCOL_VERSION;

/**
 * Per-call context handed to every {@link KindHandler}. The plugin uses
 * `pluginStateDir` for any durable bookkeeping it needs to keep across
 * boots (idempotency markers, install-history, cached checksums). The
 * directory:
 *   - is plugin-private; the runtime channel never reads or writes
 *     inside it;
 *   - is the plugin's own to lay out — the runtime channel guarantees
 *     only that the dir exists and is writable on every `apply` call;
 *   - lives on the agent's PV (survives pod restart) but is removed
 *     when the plugin's impl name disappears from the manifest.
 */
export interface DispatchContext {
  /** Absolute path to the agent's HOME. Used to resolve `$HOME` in
   *  driver-binding paths and as the safety boundary for file writes. */
  readonly agentHome: string;
  /** Plugin-private durable directory. See above for invariants. */
  readonly pluginStateDir: string;
  /** Stderr-style log sink scoped to the plugin. Prefix is added by
   *  the runtime channel; the plugin writes plain messages. */
  log(msg: string): void;
}

/**
 * Per-kind reconcile function returned by {@link Plugin.bind}. Called
 * by the dispatcher on every `applyState` push with the (possibly
 * empty) desired set of contributions for the kind this handler was
 * bound to. Reconciliation is desired-state semantics: contributions
 * present must end up applied; contributions previously applied but
 * now absent must be removed where the plugin's merge mode supports
 * removal.
 *
 * Throwing aborts only this kind for this push — the dispatcher
 * isolates per-kind failures so independent kinds aren't head-of-line-
 * blocked.
 */
export type KindHandler = (
  contributions: Contribution[],
  ctx: DispatchContext,
) => Promise<void>;

/**
 * Per-kind manifest binding. `impl` selects which plugin handles the
 * kind; the remaining fields are impl-specific config (e.g. `path`,
 * `paths`, `format`, `mergeMode`, `keyPath`). Each plugin owns the
 * schema for its own binding fields and is expected to validate at
 * {@link Plugin.bind} time — throw with a clear error on invalid
 * config so the agent boot fails fast.
 */
export type DriverBinding = Readonly<{ impl: string }> &
  Readonly<Record<string, unknown>>;

/**
 * Driver plugin. One instance per impl name across the runtime
 * channel's lifetime; `bind` is called once per kind bound to this
 * impl at manifest-load time. A single plugin may be bound to multiple
 * kinds (e.g. the built-in `file` impl could in principle handle
 * several file-shaped kinds) — the plugin is responsible for keeping
 * any cross-binding state consistent.
 */
export interface Plugin {
  /** Stable id matching `drivers.<kind>.impl` in the manifest. Built-in
   *  plugins use short names (`file`, `skill-install`); extension
   *  plugins MUST NOT use those same names. */
  readonly name: string;
  /**
   * Build a {@link KindHandler} for one `(kind, binding)` pair. Called
   * once per matching driver binding at boot. The plugin should:
   *   - validate the binding config (throw on invalid);
   *   - refuse `kind`s it doesn't support (throw with a clear message).
   */
  bind(kind: string, binding: DriverBinding): KindHandler;
}

/**
 * The module shape that a plugin file must default-export. The
 * extension loader looks for this shape on the named export — both
 * the marker and the factory.
 */
export interface PluginModule {
  readonly pluginProtocolVersion: PluginProtocolVersion;
  createPlugin(): Plugin;
}
