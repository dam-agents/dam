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

  putFields(ref: SecretRef, fields: Record<string, string>): Promise<void>;

  get(
    ref: Pick<SecretRef, "storeId" | "path">,
  ): Promise<Record<string, string> | null>;

  getField(ref: SecretRef): Promise<string | null>;

  delete(ref: Pick<SecretRef, "storeId" | "path">): Promise<void>;
}
