import { providerTypeForTemplateId } from "api-server-api";

import { providerName } from "../../providers/lib/provider-rows.js";

export function providerNameFor(templateId: string | null): string | null {
  const type = templateId ? providerTypeForTemplateId(templateId) : null;
  return type ? providerName(type) : null;
}
