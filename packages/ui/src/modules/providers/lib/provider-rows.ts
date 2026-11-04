import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  displayNameForTemplate,
} from "api-server-api";

import { type ProviderPresetType, PROVIDERS } from "../../../types.js";

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
    type: "ibm-litellm",
    description: IBM_LITELLM_DESCRIPTION,
  },
  {
    type: "bob",
    description: "IBM Bob's backend, usable by the Bob harness",
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
