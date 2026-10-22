import {
  A2UI_BASIC_CATALOG_ID as BASIC_CATALOG_ID,
  A2UI_PLATFORM_CATALOG_ID as PLATFORM_CATALOG_ID,
} from "./capabilities.js";

import type { ComponentType } from "./schema.js";

export { BASIC_CATALOG_ID, PLATFORM_CATALOG_ID };

export type AllowedCallers = "rendererOnly" | "agentOnly" | "rendererOrAgent";

export interface FunctionDefinition {
  allowedCallers: AllowedCallers;
  requiresUserActivation: boolean;
}

const RENDERER_ONLY: FunctionDefinition = {
  allowedCallers: "rendererOnly",
  requiresUserActivation: false,
};

export const BASIC_FUNCTIONS: Readonly<Record<string, FunctionDefinition>> = {
  required: RENDERER_ONLY,
  regex: RENDERER_ONLY,
  length: RENDERER_ONLY,
  numeric: RENDERER_ONLY,
  email: RENDERER_ONLY,
  formatString: RENDERER_ONLY,
  formatNumber: RENDERER_ONLY,
  formatCurrency: RENDERER_ONLY,
  formatDate: RENDERER_ONLY,
  pluralize: RENDERER_ONLY,
  openUrl: { allowedCallers: "rendererOnly", requiresUserActivation: true },
  and: RENDERER_ONLY,
  or: RENDERER_ONLY,
  not: RENDERER_ONLY,
};

const BASIC_COMPONENTS: readonly ComponentType[] = [
  "Text",
  "Image",
  "Icon",
  "Video",
  "AudioPlayer",
  "Row",
  "Column",
  "List",
  "Card",
  "Tabs",
  "Modal",
  "Divider",
  "Button",
  "TextField",
  "CheckBox",
  "ChoicePicker",
  "Slider",
  "DateTimeInput",
];

const PLATFORM_COMPONENTS: readonly ComponentType[] = [
  ...BASIC_COMPONENTS,
  "Callout",
  "Badge",
  "CodeBlock",
  "Diff",
  "Switch",
];

interface Catalog {
  components: ReadonlySet<ComponentType>;
  functions: Readonly<Record<string, FunctionDefinition>>;
}

const CATALOGS: ReadonlyMap<string, Catalog> = new Map([
  [
    BASIC_CATALOG_ID,
    { components: new Set(BASIC_COMPONENTS), functions: BASIC_FUNCTIONS },
  ],
  [
    PLATFORM_CATALOG_ID,
    { components: new Set(PLATFORM_COMPONENTS), functions: BASIC_FUNCTIONS },
  ],
]);

export const SUPPORTED_CATALOG_IDS: readonly string[] = [...CATALOGS.keys()];

export function catalogFor(catalogId: string | undefined): Catalog | undefined {
  return catalogId === undefined ? undefined : CATALOGS.get(catalogId);
}
