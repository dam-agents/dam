import type { Contribution, ContributionKind } from "agent-runtime-api";
import type { DriverBinding, RuntimeManifest } from "./manifest.js";
import type { FileImplOps, FileDesired } from "./drivers/file-impl.js";
import type {
  SkillInstallImpl,
  SkillInstallContext,
  SkillInstallInput,
} from "./drivers/skill-install-impl.js";

// Local type narrowings for the discriminated union.
type FileContrib = Extract<Contribution, { kind: "file" }>;
type McpEntryContrib = Extract<Contribution, { kind: "mcp-entry" }>;
type SkillRefContrib = Extract<Contribution, { kind: "skill-ref" }>;

export type KindHandler = (
  contributions: Contribution[],
  ctx: DispatchContext,
) => Promise<void>;

export interface DispatchContext {
  agentHome: string;
  log: (msg: string) => void;
}

export interface DispatcherDeps {
  manifest: RuntimeManifest;
  fileImpl: FileImplOps;
  skillInstallImpl: SkillInstallImpl;
  /**
   * The agent-runtime's existing skill-install helper. Injected so the
   * `skill-install` impl stays free of github/git/repo wiring.
   */
  installSkill: SkillInstallContext["install"];
  /** Resolves any `$VAR` in manifest paths (HOME, etc.). */
  expandPath: (path: string) => string;
}

export interface Dispatcher {
  /** Reconcile contributions to disk for the kinds the manifest binds. */
  apply(contributions: Contribution[], ctx: DispatchContext): Promise<void>;
}

/**
 * Per-kind dispatch wiring. For each Contribution kind in the manifest, we
 * compose a closure capturing the manifest binding's per-kind config and the
 * underlying impl. The closure adapts the per-kind contribution shape to the
 * impl's input shape.
 *
 * Kinds that don't appear in `manifest.drivers` are dropped silently — the
 * server's capability filter should not have sent them anyway, but
 * defense-in-depth.
 */
export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const handlers = new Map<ContributionKind, KindHandler>();

  for (const [kindRaw, binding] of Object.entries(deps.manifest.drivers)) {
    const kind = kindRaw as ContributionKind;
    const handler = bindHandler(kind, binding, deps);
    if (handler) handlers.set(kind, handler);
  }

  return {
    async apply(
      contributions: Contribution[],
      ctx: DispatchContext,
    ): Promise<void> {
      const byKind = new Map<ContributionKind, Contribution[]>();
      for (const c of contributions) {
        const list = byKind.get(c.kind) ?? [];
        list.push(c);
        byKind.set(c.kind, list);
      }
      for (const [kind, handler] of handlers) {
        const list = byKind.get(kind) ?? [];
        try {
          await handler(list, ctx);
        } catch (err) {
          ctx.log(`[runtime] driver ${kind} failed: ${(err as Error).message}`);
        }
      }
    },
  };
}

function bindHandler(
  kind: ContributionKind,
  binding: DriverBinding,
  deps: DispatcherDeps,
): KindHandler | null {
  switch (kind) {
    case "file":
      return bindFileKind(binding, deps);
    case "mcp-entry":
      return bindMcpEntryKind(binding, deps);
    case "skill-ref":
      return bindSkillRefKind(binding, deps);
    case "env":
    case "egress-host":
      // These contributions never reach the agent runtime — the api-server
      // fan-out routes them to the env-render rail and the egress_rules
      // table respectively. The capability filter on `hello` excludes them
      // from the agent's payload; the dispatcher ignores them defensively.
      return null;
  }
}

function bindFileKind(
  binding: DriverBinding,
  deps: DispatcherDeps,
): KindHandler | null {
  if (binding.impl !== "file") return null;
  return async (contribs, ctx) => {
    const desired = new Map<string, FileDesired[]>();
    for (const c of contribs as FileContrib[]) {
      const path = deps.expandPath(c.path);
      const list = desired.get(path) ?? [];
      list.push({
        format: c.format,
        mergeMode: c.mergeMode,
        content: c.content,
      });
      desired.set(path, list);
    }
    await deps.fileImpl.apply(desired, {
      agentHome: ctx.agentHome,
      log: ctx.log,
    });
  };
}

function bindMcpEntryKind(
  binding: DriverBinding,
  deps: DispatcherDeps,
): KindHandler | null {
  if (binding.impl !== "file") return null;
  // For mcp-entry we need a per-kind file binding (path/format/mergeMode/
  // keyPath). For `file` kind these come from each contribution; for
  // `mcp-entry` they're fixed by the manifest.
  const path = binding.path;
  const format = binding.format;
  const mergeMode = binding.mergeMode;
  if (!path || !format || !mergeMode) return null;
  const expandedPath = deps.expandPath(path);
  const keyPath = binding.keyPath;
  return async (contribs, ctx) => {
    const entries: Record<string, unknown> = {};
    for (const c of contribs as McpEntryContrib[]) {
      entries[c.name] = {
        type: "http",
        url: c.url,
        ...(c.headers ? { headers: c.headers } : {}),
      };
    }
    const effectiveKey = keyPath ?? "mcpServers";
    const content: Record<string, unknown> = keyPath
      ? entries
      : { [effectiveKey]: entries };
    const desired = new Map<string, FileDesired[]>([
      [
        expandedPath,
        [
          {
            format,
            mergeMode,
            keyPath,
            content,
          },
        ],
      ],
    ]);
    await deps.fileImpl.apply(desired, {
      agentHome: ctx.agentHome,
      log: ctx.log,
    });
  };
}

function bindSkillRefKind(
  binding: DriverBinding,
  deps: DispatcherDeps,
): KindHandler | null {
  if (binding.impl !== "skill-install") return null;
  if (!binding.paths || binding.paths.length === 0) return null;
  const skillPaths = binding.paths.map(deps.expandPath);
  return async (contribs, ctx) => {
    const desired: SkillInstallInput[] = (contribs as SkillRefContrib[]).map(
      (c) => ({
        sourceUrl: c.sourceUrl,
        name: c.name,
        version: c.version,
      }),
    );
    await deps.skillInstallImpl.apply(desired, {
      paths: skillPaths,
      log: ctx.log,
      install: deps.installSkill,
    });
  };
}
