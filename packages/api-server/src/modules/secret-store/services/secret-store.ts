import type { SecretRef } from "api-server-api";

/**
 * Cross-cutting secret-storage abstraction (ADR-051 §"K8s Secret per
 * Connection" — generalised). Adapters today: K8s Secrets. Future:
 * Hashicorp Vault, AWS Secrets Manager, GCP Secret Manager, etc.
 *
 * Callers (Connections service, OAuth refresh loop, Header credentials,
 * channel secrets, …) work in terms of SecretRef + field name only and
 * never see the underlying transport. Swapping the store is an adapter
 * change at the composition root — call sites do not change.
 *
 * Field naming is the caller's contract — e.g. an OAuth Connection stores
 * `access_token`, `refresh_token`, `client_id`, `client_secret` as four
 * fields under one path. The adapter doesn't interpret field names.
 */
export interface SecretMetadata {
  /** Principal the secret belongs to. K8s adapter labels; Vault tags. */
  owner: string;
  /**
   * Caller-defined purpose tag (e.g. `connection:<id>`,
   * `channel:slack:<id>`). Opaque to the adapter; surfaced back in
   * `list()` results so cleanup sweeps can filter.
   */
  purpose: string;
  /**
   * Adapter-specific extra metadata. The K8s adapter merges these into the
   * Secret's `metadata.labels` / `metadata.annotations` alongside the
   * generic owner/managed-by/purpose set. Used by callers (e.g. the
   * Connections service) to stamp the discriminators the controller's
   * Secret filter reads (`secret-type=connection`, `connection=<id>`,
   * `env-mappings`, `injection-hosts`). Other adapters may ignore them.
   */
  extraLabels?: Record<string, string>;
  extraAnnotations?: Record<string, string>;
}

export interface SecretStore {
  /**
   * Logical store identifier this adapter answers to. Multi-store
   * deployments route SecretRefs by `storeId` via SecretStoreRegistry.
   * Single-store deployments use a single adapter with id `"default"`.
   */
  readonly storeId: string;

  /**
   * Allocate a new SecretRef for the given owner-scoped purpose. The
   * adapter picks the underlying path so callers never bake the K8s/
   * Vault/AWS naming convention into domain code.
   *
   * Returned ref's `field` is the empty string — callers add fields via
   * `put` / `putField`. The ref itself is the path; concrete fields are
   * derived (`{...ref, field: "access_token"}`).
   */
  mintRef(meta: SecretMetadata): SecretRef;

  /**
   * Replace the full payload at this path with the supplied fields and
   * apply the metadata tags (labels in K8s, tags in Vault/AWS).
   * Idempotent on path — overwrites any existing fields.
   */
  put(
    ref: SecretRef,
    fields: Record<string, string>,
    meta: SecretMetadata,
  ): Promise<void>;

  /**
   * Patch one field. Idempotent — used by the OAuth refresh loop to swap
   * a rotated access token without touching the refresh token at the
   * same path. Does NOT change metadata tags — those stay as set by `put`.
   */
  putField(ref: SecretRef, value: string): Promise<void>;

  /**
   * Patch multiple fields at once. Same semantics as `putField` but for
   * the case where several derived fields (raw token + per-host SDS files
   * for a Connection) must land atomically. Preserves any fields not
   * mentioned, and preserves metadata tags. Errors if the secret does not
   * exist — callers use `put` to create.
   */
  putFields(ref: SecretRef, fields: Record<string, string>): Promise<void>;

  /**
   * Read all fields at this path. Returns null if the path doesn't exist.
   * Most callers want `getField` instead.
   */
  get(
    ref: Pick<SecretRef, "storeId" | "path">,
  ): Promise<Record<string, string> | null>;

  /**
   * Read one field. Returns null if path or field is absent.
   */
  getField(ref: SecretRef): Promise<string | null>;

  /**
   * Remove the entire secret at this path. Idempotent.
   */
  delete(ref: Pick<SecretRef, "storeId" | "path">): Promise<void>;

  /**
   * Enumerate paths the adapter has stored for an owner. Drives the
   * OAuth refresh-loop sweep and per-owner cleanup hooks. Filter by
   * `purpose` to scope to a subsystem (e.g. only Connection secrets,
   * not channel secrets).
   */
  list(scope: {
    owner: string;
    /** Optional purpose filter — exact match against the metadata tag. */
    purpose?: string;
  }): Promise<{ ref: SecretRef; metadata: SecretMetadata }[]>;
}

/**
 * Resolves SecretRefs to their backing SecretStore adapter. A single-store
 * deployment registers one adapter under id `"default"`; multi-store
 * deployments register multiple, and the ref's `storeId` chooses.
 */
export interface SecretStoreRegistry {
  register(store: SecretStore): void;
  default(): SecretStore;
  resolve(ref: Pick<SecretRef, "storeId">): SecretStore;
  /** All registered stores. Used by the refresh-loop sweep across stores. */
  all(): SecretStore[];
}

export class SecretStoreNotFoundError extends Error {
  constructor(storeId: string | undefined) {
    super(
      `no secret store registered for id ${JSON.stringify(storeId ?? "default")}`,
    );
    this.name = "SecretStoreNotFoundError";
  }
}

export function createSecretStoreRegistry(): SecretStoreRegistry {
  const stores = new Map<string, SecretStore>();
  let defaultId: string | undefined;
  return {
    register(store): void {
      stores.set(store.storeId, store);
      if (!defaultId) defaultId = store.storeId;
    },
    default(): SecretStore {
      if (!defaultId) throw new SecretStoreNotFoundError(undefined);
      return stores.get(defaultId)!;
    },
    resolve(ref): SecretStore {
      const id = ref.storeId ?? defaultId;
      const store = id ? stores.get(id) : undefined;
      if (!store) throw new SecretStoreNotFoundError(ref.storeId);
      return store;
    },
    all(): SecretStore[] {
      return Array.from(stores.values());
    },
  };
}
