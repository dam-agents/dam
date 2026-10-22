import {
  displayNameForTemplate,
  providerTypeForTemplateId,
} from "api-server-api";

import { providerName } from "../../providers/lib/provider-rows.js";

export function providerNameFor(templateId: string | null): string | null {
  if (!templateId) return null;
  const type = providerTypeForTemplateId(templateId);
  return type
    ? providerName(type, templateId)
    : displayNameForTemplate(templateId);
}
