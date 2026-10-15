export const A2UI_BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
export const A2UI_PLATFORM_CATALOG_ID = "urn:platform:a2ui:catalog:chat:v1";

export const A2UI_CHAT_EXTENSION_ID = "urn:platform:a2ui:extension:chat:v1";

export const CHAT_FORM_CATALOG_IDS: readonly string[] = [
  A2UI_PLATFORM_CATALOG_ID,
  A2UI_BASIC_CATALOG_ID,
];

export function chatFormCapabilities(): string {
  const capabilities = {
    "v1.0": { supportedCatalogIds: CHAT_FORM_CATALOG_IDS },
  };
  return `<a2ui-capabilities>\n${JSON.stringify(capabilities)}\n</a2ui-capabilities>`;
}
