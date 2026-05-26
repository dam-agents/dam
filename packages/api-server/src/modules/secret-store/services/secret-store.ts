import type { SecretRef } from "api-server-api";

export interface SecretMetadata {
  owner: string;
  purpose: string;
  extraLabels?: Record<string, string>;
  extraAnnotations?: Record<string, string>;
}

export interface SecretStore {
  readonly storeId: string;

  mintRef(meta: SecretMetadata): SecretRef;

  put(
    ref: SecretRef,
    fields: Record<string, string>,
    meta: SecretMetadata,
  ): Promise<void>;

  putField(ref: SecretRef, value: string): Promise<void>;

  putFields(ref: SecretRef, fields: Record<string, string>): Promise<void>;

  get(
    ref: Pick<SecretRef, "storeId" | "path">,
  ): Promise<Record<string, string> | null>;

  getField(ref: SecretRef): Promise<string | null>;

  delete(ref: Pick<SecretRef, "storeId" | "path">): Promise<void>;

  list(scope: {
    owner: string;
    purpose?: string;
  }): Promise<{ ref: SecretRef; metadata: SecretMetadata }[]>;
}

export interface SecretStoreRegistry {
  register(store: SecretStore): void;
  default(): SecretStore;
  resolve(ref: Pick<SecretRef, "storeId">): SecretStore;
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
