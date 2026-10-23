/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform's one OAuth client identity for MCP
 * servers whose authorization server accepts a Client ID Metadata Document.
 * The client_id is the HTTPS URL of a JSON document the api-server serves next
 * to the OAuth callback, so no client is registered per server.
 */

export const CLIENT_ID_METADATA_FILE = "client-metadata.json";

export interface ClientIdMetadataDocument {
  client_id: string;
  client_name: string;
  client_uri: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
}

export function platformOAuthClientName(brandName: string): string {
  return `${brandName} Agent Platform`;
}

export function clientIdMetadataUrl(callbackUrl: string): string {
  return new URL(CLIENT_ID_METADATA_FILE, callbackUrl).href;
}

export type OAuthClientSource =
  | { kind: "metadata-document"; clientId: string }
  | { kind: "registration"; registrationEndpoint: string };

export function oauthClientSource(
  server: {
    clientIdMetadataDocumentSupported?: boolean;
    registrationEndpoint?: string;
  },
  callbackUrl: string,
): OAuthClientSource | null {
  const metadataUrl = clientIdMetadataUrl(callbackUrl);
  if (
    server.clientIdMetadataDocumentSupported &&
    new URL(metadataUrl).protocol === "https:"
  )
    return { kind: "metadata-document", clientId: metadataUrl };
  if (server.registrationEndpoint)
    return {
      kind: "registration",
      registrationEndpoint: server.registrationEndpoint,
    };
  return null;
}

export function clientIdMetadataDocument(opts: {
  callbackUrl: string;
  brandName: string;
}): ClientIdMetadataDocument {
  return {
    client_id: clientIdMetadataUrl(opts.callbackUrl),
    client_name: platformOAuthClientName(opts.brandName),
    client_uri: new URL(opts.callbackUrl).origin,
    redirect_uris: [opts.callbackUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}
