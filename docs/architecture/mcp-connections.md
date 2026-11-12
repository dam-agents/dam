# MCP connections

Last verified: 2026-11-07

A custom MCP server is a [Connection](connections.md) whose endpoint becomes an MCP entry when an Agent holds it.
Credentials stay gateway-side, as other Connection credentials do.
This page owns its OAuth client discovery and the scopes and resource identifier used through sign-in and refresh.

## OAuth client

The OAuth client is found at create time, in the order the MCP authorization spec gives: a client ID the user entered, else the platform's **Client ID Metadata Document** when the authorization server says it accepts one, else Dynamic Client Registration.
The document is one per deployment, served without sign-in beside the OAuth callback, which is its only redirect URI; its URL is the client ID, so no client is registered per server and there is no client secret to keep.
An authorization server fetches only an HTTPS client ID, so a deployment served over plain HTTP registers instead.
One rule in the [connections module](../../packages/api-server/src/modules/connections/) picks the client, for the create path and for the discovery that tells the UI and CLI a server takes OAuth.

## Scopes and resource binding

Discovery takes the requested scopes from the MCP endpoint's Protected Resource Metadata.
Discovery validates the metadata's resource identifier against the endpoint and carries it through authorization, code exchange and refresh requests.
When metadata omits the identifier, the endpoint's scheme, host and path supply its canonical form.
Each interactive sign-in rediscovers the MCP resource and requested scopes before authorization starts; the callback keeps that configuration and stores it separately from the scopes the server grants.
If only authorization-server metadata is available, a Connection with stored resource binding keeps that binding and its requested scopes.
Refresh uses the stored configuration, so it does not depend on the MCP metadata endpoint being available.
An older Connection acquires resource binding when its user signs in again and Protected Resource Metadata is available.
If Protected Resource Metadata remains unavailable, an older unbound Connection stays unbound until a later sign-in discovers it.
