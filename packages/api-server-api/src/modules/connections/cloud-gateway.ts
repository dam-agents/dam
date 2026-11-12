import { DEFAULT_ENV_PLACEHOLDER, type EnvMapping } from "./providers.js";

export const CLOUD_GATEWAY_ENDPOINT_ENV = "OPENAI_BASE_URL";
export const CLOUD_GATEWAY_KEY_ENV = "OPENAI_API_KEY";

const REGION_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const PROJECT_ID = "[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one shape of endpoint a CurveBender
 * Connection through the IBM Cloud Gateway accepts: HTTPS, one region label
 * under the gateway's domain, and a project's inference path with nothing
 * after it. The host decides where the credential gateway injects the key, so
 * any other host, a nested subdomain, a port, plain HTTP or a longer path is
 * refused rather than widened into a general base-URL provider.
 */
export const CLOUD_GATEWAY_ENDPOINT_PATTERN = `https://${REGION_LABEL}\\.rhai\\.ibm\\.com/v1/projects/${PROJECT_ID}/inference`;

const ENDPOINT_RE = new RegExp(
  `^https://(${REGION_LABEL}\\.rhai\\.ibm\\.com)(/v1/projects/${PROJECT_ID}/inference)$`,
);

export interface CloudGatewayEndpoint {
  url: string;
  host: string;
  path: string;
}

export function parseCloudGatewayEndpoint(
  value: string,
): CloudGatewayEndpoint | null {
  const url = trimTrailingSlashes(value.trim());
  const match = ENDPOINT_RE.exec(url);
  if (!match) return null;
  return { url, host: match[1]!, path: match[2]! };
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

export function cloudGatewayEnvMappings(): EnvMapping[] {
  return [
    { envName: CLOUD_GATEWAY_KEY_ENV, placeholder: DEFAULT_ENV_PLACEHOLDER },
  ];
}
