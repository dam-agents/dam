import type { SecretRef } from "api-server-api";

export interface SecretMetadata {
  owner: string;
  purpose: string;
  extraLabels?: Record<string, string>;
  extraAnnotations?: Record<string, string>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a credential store must do. `list` is
 * owner-scoped because that is how the product asks the question;
 * `listByPurpose` crosses owners because an orphan sweep runs after the record
 * that pointed at a secret is gone, leaving it no owner to scope by. A ref
 * carries the id of the store that minted it, and a store refuses one that is
 * not its own — which is the whole of what a registry used to be for.
 */
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

  listByPurpose(
    purpose: string,
  ): Promise<{ ref: SecretRef; metadata: SecretMetadata }[]>;
}
