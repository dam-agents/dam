import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";

import type { ProviderPresetType } from "../../../types.js";
import type { ProviderItem } from "../components/provider-item.js";

interface ProviderRowDef {
  type: ProviderPresetType;
  description: string;
}

export const IBM_LITELLM_DESCRIPTION =
  "IBM's external LiteLLM proxy — Claude on watsonx-routed AWS.";

export const CURVE_BENDER_DESCRIPTION =
  "IBM's internal inference on open-source models";

export const PROVIDER_ROWS: readonly ProviderRowDef[] = [
  {
    type: "ibm-litellm",
    description: IBM_LITELLM_DESCRIPTION,
  },
  {
    type: "curve-bender",
    description: CURVE_BENDER_DESCRIPTION,
  },
  {
    type: "bob",
    description:
      "IBM Bob Shell endpoint with twin-secret credential injection.",
  },
  {
    type: "anthropic",
    description:
      "Claude Code, Claude SDK, and any Anthropic-compatible client.",
  },
  {
    type: "openai",
    description: "GPT-family models for Codex and OpenAI-compatible agents.",
  },
  {
    type: "bedrock",
    description:
      "Models your organization hosts in AWS Bedrock, for Claude Code and Pi agents.",
  },
];

export function offeredProviderRows(
  allow?: readonly ProviderPresetType[],
  recommended?: ProviderPresetType,
): readonly ProviderRowDef[] {
  const offered = allow
    ? PROVIDER_ROWS.filter((row) => allow.includes(row.type))
    : PROVIDER_ROWS;
  if (!recommended) return offered;
  return [...offered].sort(
    (a, b) => Number(b.type === recommended) - Number(a.type === recommended),
  );
}

export type ProviderChoice =
  ProviderPresetType | typeof CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID;

interface ProviderChoiceRow extends ProviderRowDef {
  choice: ProviderChoice;
  item: ProviderItem | undefined;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the choices the provider picker lists, in row
 * order. The deployment's shared CurveBender is a choice of its own, next to
 * the own-key row; the own-key row stays only while the person holds an own
 * key, as on Settings / Providers. Auto-select takes the first choice the
 * person holds, or the shared one when the form asks for it.
 * sharedOffered says the shared CurveBender is among the choices.
 */
export function providerChoices(
  rows: readonly ProviderRowDef[],
  items: {
    itemByType: ReadonlyMap<ProviderPresetType, ProviderItem>;
    shared: ProviderItem | undefined;
  },
  preferShared: boolean,
): {
  choices: ProviderChoiceRow[];
  autoSelect: ProviderItem | undefined;
  sharedOffered: boolean;
} {
  const { itemByType, shared } = items;
  const choices = rows.flatMap((row): ProviderChoiceRow[] => {
    const own = { ...row, choice: row.type, item: itemByType.get(row.type) };
    if (row.type !== "curve-bender" || !shared) return [own];
    const sharedChoice: ProviderChoiceRow = {
      ...row,
      choice: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
      item: shared,
    };
    return own.item ? [sharedChoice, own] : [sharedChoice];
  });
  const sharedOffered = choices.find(
    (c) => c.choice === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  )?.item;
  return {
    choices,
    autoSelect:
      (preferShared ? sharedOffered : undefined) ??
      choices.find((c) => c.item)?.item,
    sharedOffered: sharedOffered !== undefined,
  };
}
