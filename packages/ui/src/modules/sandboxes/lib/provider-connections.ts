import { type ConnectionView, PROVIDER_TEMPLATE_IDS } from "api-server-api";

export const excludeProviderConnections = (
  connections: readonly ConnectionView[],
): ConnectionView[] =>
  connections.filter((c) => !PROVIDER_TEMPLATE_IDS.has(c.templateId));
