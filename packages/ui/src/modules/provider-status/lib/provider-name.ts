import { displayNameForTemplate } from "api-server-api";

export function providerNameFor(templateId: string | null): string | null {
  return templateId ? displayNameForTemplate(templateId) : null;
}
