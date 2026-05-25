import { z } from "zod";
import type {
  ConnectionAuthConfig,
  ConnectionCategory,
  ConnectionTemplateView,
  Contribution,
  SecretRef,
} from "api-server-api";

/**
 * Connection Template (ADR-051) — code-level catalog entry. Premade
 * templates ship full defaults (GitHub, Anthropic, Spotify, Linear MCP, …).
 * Custom templates ship the *shape* but leave the integration's identity
 * for the user to fill in (Custom MCP, Custom OAuth, Custom Header).
 *
 * The template's `build()` projects raw user inputs into a concrete
 * `auth` + `contributions[]` pair — the Connection record's authoritative
 * shape. The Connections service calls `build()` on create, persists the
 * result, and never re-derives.
 */
export interface ConnectionTemplate<Inputs = unknown> {
  readonly id: string;
  readonly name: string;
  readonly category: ConnectionCategory;
  readonly isCustom: boolean;

  /** UI strings. Not used at runtime. */
  readonly description?: string;
  readonly iconSlug?: string;

  /** Auth modes the template can produce. UI uses this to render forms. */
  readonly authKinds: readonly ("oauth" | "header" | "none")[];

  /** Contribution kinds the template emits. UI surfaces these as a heads-up. */
  readonly contributedKinds: readonly string[];

  /** Zod schema validating user-typed inputs. The wire input arrives as
   *  `Record<string, unknown>`; this gates it before `build()`. */
  readonly inputs: z.ZodType<Inputs>;

  /**
   * Project validated inputs to the Connection record's `auth` +
   * `contributions[]`. The factory receives a `mintSecretRef` callback so
   * the template doesn't have to know about the underlying SecretStore.
   */
  build(input: BuildInput<Inputs>): BuildOutput;

  /** UI view projection. The Connections service joins this on `listTemplates`. */
  toView(): ConnectionTemplateView;
}

export interface BuildInput<Inputs> {
  ownerId: string;
  inputs: Inputs;
  /**
   * Mint a fresh SecretRef path the caller will then `put` into.
   * Returns the path-only ref (no `field`) — `build` assembles the final
   * `{path, field: "..."}` refs that show up in the auth payload.
   */
  mintSecretRef(purpose: string): SecretRef;
}

export interface BuildOutput {
  auth: ConnectionAuthConfig;
  contributions: Contribution[];
  /**
   * Secret fields to write at `auth.*Ref.path` at create time. Map of
   * path → field → value. The Connections service writes these via
   * SecretStore.put before persisting the Connection row.
   */
  secrets: Map<string, Record<string, string>>;
  /**
   * Initial display name for the Connection. Templates derive from inputs
   * (e.g. "GHE (ghe.acme.com)") so re-listings stay coherent.
   */
  defaultName: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────

export interface ConnectionTemplateRegistry {
  list(): ConnectionTemplate[];
  get(id: string): ConnectionTemplate | null;
}

export function createConnectionTemplateRegistry(
  templates: readonly ConnectionTemplate[],
): ConnectionTemplateRegistry {
  const byId = new Map<string, ConnectionTemplate>();
  for (const t of templates) {
    if (byId.has(t.id)) {
      throw new Error(`duplicate Connection Template id: ${t.id}`);
    }
    byId.set(t.id, t);
  }
  return {
    list(): ConnectionTemplate[] {
      return Array.from(byId.values());
    },
    get(id): ConnectionTemplate | null {
      return byId.get(id) ?? null;
    },
  };
}
