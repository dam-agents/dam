# MCP connections

Last verified: 2026-11-24

A custom MCP server is a [Connection](connections.md) whose endpoint becomes an MCP entry when an Agent holds it.
Credentials stay gateway-side, as other Connection credentials do.
This page owns its OAuth client discovery, the scopes and resource identifier used through sign-in and refresh, and how the platform reads its tool list.

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
Sign-in rediscovers from the same endpoint the create path used: the catalog template's fixed MCP address when it has one, such as Figma's, else the URL the user entered.
If only authorization-server metadata is available, a Connection with stored resource binding keeps that binding and its requested scopes.
Refresh uses the stored configuration, so it does not depend on the MCP metadata endpoint being available.
An older Connection acquires resource binding when its user signs in again and Protected Resource Metadata is available.
If Protected Resource Metadata remains unavailable, an older unbound Connection stays unbound until a later sign-in discovers it.

## Tool list

The api-server reads an MCP server's tool list with the Connection's own credential, so that tool access knows which tools read ([connections](connections.md#connection)).
It connects as an MCP client over Streamable HTTP to the address of the Connection's MCP entry, with the credential in the header the gateway injects: the OAuth access token, refreshed first when it is about to expire, or the header value.
It pages through the list up to 1000 tools and gives up after 15 seconds in all.
It follows a redirect only on the same origin, so the credential never reaches another host.
A failure is stored as a short reason the owner can read, such as the HTTP status or a timeout.
A custom MCP server with no auth has no Secret, so the gateway does not read its requests and cannot hold an Agent to a tool access: it allows every tool, and its tool list is not read.
