import {
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  displayNameForTemplate,
} from "api-server-api";

import { getBrand } from "../../../brand.js";
import { type ProviderPresetType, PROVIDERS } from "../../../types.js";

export interface ProviderRowDef {
  type: ProviderPresetType;
  templateId?: string;
  description: string;
}

export const IBM_LITELLM_DESCRIPTION =
  "IBM's LiteLLM proxy for Claude, GPT and other models — Anthropic, OpenAI Chat and Responses APIs.";

export const CURVE_BENDER_DESCRIPTION =
  "Open-source models hosted internally in IBM.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the built-in provider is named by the brand, not
 * by the codename its preset carries; any other preset takes its template's
 * name when it has one, so a user-keyed provider and the deployment's read
 * differently.
 */
export function providerName(
  type: ProviderPresetType,
  templateId?: string,
): string {
  if (type === "platform") return getBrand().name;
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
    type: "platform",
    description: "Models this install serves itself, with no API key.",
  },
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
    description: "IBM's model endpoint for Bob Shell.",
  },
  {
    type: "bedrock",
    description:
      "Models available in your AWS region for Claude and Pi, using a Bedrock API key.",
  },
  {
    type: "anthropic",
    description:
      "Claude models for Claude and Pi. API keys also support OpenAI Chat Completions; OAuth is Claude-only.",
  },
  {
    type: "openai",
    description:
      "OpenAI models for Codex and Pi via Chat Completions and Responses APIs.",
  },
];
