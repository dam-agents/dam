import { type ConnectionView, PROVIDER_TEMPLATE_IDS } from "api-server-api";

export const isProviderConnection = (c: ConnectionView): boolean =>
  PROVIDER_TEMPLATE_IDS.has(c.templateId);

export const excludeProviderConnections = (
  connections: readonly ConnectionView[],
): ConnectionView[] => connections.filter((c) => !isProviderConnection(c));
