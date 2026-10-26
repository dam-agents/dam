import type {
  CatalogModelView,
  CatalogProviderStatus,
} from "agent-runtime-api";
import type { ProviderAlias } from "../connections/providers.js";

export interface ProviderCatalogModel extends CatalogModelView {
  harnesses: string[];
}

export interface ProviderCatalogView {
  connectionId: string;
  alias: ProviderAlias;
  template: string;
  displayName: string;
  status: CatalogProviderStatus;
  listedAt: string | null;
  harnesses: string[];
  models: ProviderCatalogModel[];
}

export interface OwnerModelCatalogView {
  providers: ProviderCatalogView[];
}
