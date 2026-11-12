import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  displayNameForTemplate,
  shortNameForTemplate,
} from "api-server-api";

import { type ProviderPresetType, PROVIDERS } from "../../../types.js";
import { connectionLabel } from "../../connections/lib/connection-label.js";
import type { ProviderItem } from "../components/provider-item.js";

export interface ProviderRowDef {
  type: ProviderPresetType;
  templateId?: string;
  description: string;
}

export const IBM_LITELLM_DESCRIPTION =
  "IBM Research's gateway to external model providers";

export const CURVE_BENDER_DESCRIPTION =
  "IBM's internal inference on open-source models";

/**
 * UNIT_BOUNDARY_DESCRIPTION: one preset can offer a user-keyed template and
 * the deployment's under different names, so a row takes its template's name
 * when that template has one of its own.
 */
export function providerName(
  type: ProviderPresetType,
  templateId?: string,
): string {
  return (
    (templateId ? displayNameForTemplate(templateId) : null) ??
    PROVIDERS[type].displayName
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: a Connection named shortly for a one-line summary, "IBM proxy" beside its long Settings name, falling back to the Connection's own name when its template has no short one. */
export function shortProviderName(connection: {
  templateId?: string | undefined;
  name: string;
}): string {
  return (
    (connection.templateId
      ? shortNameForTemplate(connection.templateId)
      : null) ?? connection.name
  );
}

export function providerRowName(row: ProviderRowDef): string {
  return providerName(row.type, row.templateId);
}

export const PROVIDER_ROWS: readonly ProviderRowDef[] = [
  {
    type: "curve-bender",
    templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
    description: CURVE_BENDER_DESCRIPTION,
  },
  {
    type: "curve-bender",
    templateId: "curve-bender",
    description: CURVE_BENDER_DESCRIPTION,
  },
  {
    type: "curve-bender-cloud-gateway",
    description: "CurveBender through your team's IBM Cloud Gateway project",
  },
  {
    type: "ibm-litellm",
    description: IBM_LITELLM_DESCRIPTION,
  },
  {
    type: "bob",
    description: "IBM Bob's backend",
  },
  {
    type: "bedrock",
    description: "Amazon Web Services inference engine",
  },
  {
    type: "anthropic",
    description: "Claude models straight from the source",
  },
  {
    type: "openai",
    description: "GPT models straight from the source",
  },
];

export function providerDescription(
  type: ProviderPresetType,
  templateId?: string,
): string | undefined {
  return (
    PROVIDER_ROWS.find(
      (row) => row.templateId === templateId && row.type === type,
    ) ?? PROVIDER_ROWS.find((row) => row.type === type)
  )?.description;
}

export interface ProviderEntry {
  key: string;
  row: ProviderRowDef;
  item: ProviderItem | undefined;
  name: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a provider row stands once for each connection the
 * owner holds of it, or once to connect it when they hold none. Several
 * connections of one provider each take the connection's own name after the
 * provider's, so each row says which one it is.
 */
export function providerEntries(
  row: ProviderRowDef,
  items: readonly ProviderItem[],
): ProviderEntry[] {
  const base = `${row.type}:${row.templateId ?? ""}`;
  const name = providerRowName(row);
  if (items.length === 0) return [{ key: base, row, item: undefined, name }];
  return items.map((item) => ({
    key: `${base}:${item.id}`,
    row,
    item,
    name: items.length > 1 ? `${name} (${connectionLabel(item.conn)})` : name,
  }));
}
