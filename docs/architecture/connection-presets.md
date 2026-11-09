# Connection presets

Last verified: 2026-11-09

What each shipped Connection Template gives an Agent: the template's shape, the hosts it reaches, the credential the gateway injects and the Contributions a grant materializes.
The model they all share — a template, a grant, and which rail each Contribution kind takes — is on [connections](connections.md).

## App preset: GitHub Enterprise

```jsonc
{
  "id": "conn-7a8b",
  "templateId": "github-enterprise",
  "name": "GHE (ghe.acme.com)",
  "inputs": { "host": "ghe.acme.com", "clientId": "…", "clientSecret": "…" },
  "auth": {
    "kind": "oauth",
    "clientId": "Iv1.…",
    "refreshTokenRef": { "secretName": "platform-secret-conn-7a8b", "key": "refresh_token" },
    "accessTokenRef":  { "secretName": "platform-secret-conn-7a8b", "key": "access_token" },
    "scopes": ["repo", "read:user", "user:email"]
  },
  "contributions": [
    { "kind": "egress-allow", "host": "ghe.acme.com" },
    { "kind": "env",          "name": "GH_TOKEN", "placeholder": "dummy-placeholder" },
    { "kind": "env",          "name": "GH_HOST",  "placeholder": "ghe.acme.com" },
    { "kind": "file",
      "path": "$HOME/.config/gh/hosts.yml",
      "format": "yaml",
      "mergeMode": "key-targeted",
      "content": { "ghe.acme.com": { "oauth_token": "dummy-placeholder", "git_protocol": "https" } } }
  ]
}
```

## Custom MCP server

An MCP endpoint contributes an `egress-allow` for its host and an `mcp-entry` carrying the server URL.
OAuth adds a placeholder Authorization header on the `mcp-entry`; a static-header credential instead adds an `egress-inject` (as Custom Header does), keeping the secret gateway-side.
The OAuth client is found at create time, in the order the MCP authorization spec gives: a client ID the user entered, else the platform's **Client ID Metadata Document** when the authorization server says it accepts one, else Dynamic Client Registration.
The document is one per deployment, served without sign-in beside the OAuth callback, which is its only redirect URI; its URL is the client ID, so no client is registered per server and there is no client secret to keep.
An authorization server fetches only an HTTPS client ID, so a deployment served over plain HTTP registers instead.
One rule in the [connections module](../../packages/api-server/src/modules/connections/) picks the client, for the create path and for the discovery that tells the UI and CLI a server takes OAuth.

## Shared knowledge base

A hidden managed template behind the [knowledge-base sharing](knowledge-bases.md#sharing) consumer flow — never offered in the generic catalog; its connections surface only in an agent's **Knowledge** settings.
One lookup both authorizes the pasted share string against a live share and settles which knowledge base it reaches, and the connection is **identified by that knowledge base** rather than by the link it arrived on: unsharing retires a share id and re-sharing mints a fresh one, so a link for a knowledge base already connected re-points the row that exists — one entry per knowledge base per owner, a constraint the store enforces, never a dead entry beside a live one — while a link that no longer resolves is refused instead of stored half-identified.
The secret lands in the per-Connection Secret under a **per-share header name** (`x-kb-token-<shareId>`), which is what the serving side authenticates and what keeps several shares distinct within one request.
The owner's public name is readable only to a consumer whose secret still works, so the connection remembers the last one it saw and stops following renames once the secret it holds stops working — a row that broke still says which knowledge base it was, beside the expired status explaining it.
Deliberately **no** `mcp-entry` per connection: one built-in aggregate entry serves all of a sandbox's shares (below).
Reads are served **in-cluster over the harness**, not by the agent dialing the platform's share host — the platform reads an agent's granted shares and replays their per-share secrets into the aggregate serving app server-side (see [knowledge bases](knowledge-bases.md#sharing)), so the consumer path needs no egress.
Connections of this template are capped per owner.

## App preset: Kubernetes / OpenShift

The external-cluster connection (#2314).
The user supplies the cluster API endpoint, a service-account token, and — only when the API cert isn't publicly trusted — the cluster's CA.
The build synthesizes an `egress-inject`, a `file` contribution writing a ready-to-use kubeconfig at a **per-connection path**, and a `KUBECONFIG` `env` pointing at it.
The kubeconfig carries only an inert placeholder token; the gateway overwrites it with the real service-account token on the wire, so the token only ever exists gateway-side.
Multiple cluster connections compose: each writes its own kubeconfig keyed by connection name, and the `env` driver joins their `KUBECONFIG` entries into the `:`-separated list `kubectl`/`oc` merge at load, so clusters that share a host on different ports stay distinct.
The CA is optional, never reaches the agent, and configures gateway-side upstream validation only.

```jsonc
{
  "id": "conn-9c1d",
  "templateId": "kubernetes",
  "name": "prod-cluster",
  "inputs": { "host": "api.prod.example:6443", "value": "…", "caData": "…" },
  "auth": { "kind": "header", "valueRef": { "…": "…" }, "headerName": "Authorization", "valueFormat": "Bearer {value}" },
  "contributions": [
    { "kind": "egress-inject", "host": "api.prod.example", "port": 6443,
      "headerName": "Authorization", "valueFormat": "Bearer {value}",
      "upgrades": true, "upstreamCa": true },
    { "kind": "env", "name": "KUBECONFIG", "placeholder": "$HOME/.kube/connections/prod-cluster.config" },
    { "kind": "file", "path": "$HOME/.kube/connections/prod-cluster.config", "format": "yaml",
      "mergeMode": "overwrite",
      "content": { /* a one-cluster kubeconfig: the endpoint, the mounted CA path, and a placeholder token */ } }
  ]
}
```

## Platform preset: this install itself

The Connection that lets an Agent drive this install as its owner (D256A), one per owner, and the client of the [CLI](cli.md#agent-skill) inside the agent: the `dam` of the agent's own image, pointed at the install it runs on.
It is never offered in the catalog, and the owner can neither create it nor paste a credential into it, because the platform mints both.
Provisioning is idempotent and takes the first free name, which is the brand's.

Its credential is an **owner API key** the platform mints at create, named so the owner sees it in Settings › API keys.
It carries every scope a person's own key can and none of the satellite scopes, which run work queued for other Agents; an API key never carries the operator role.
It is stored in the per-Connection Secret as a header credential, and the Connection remembers the key's id, so deleting the Connection revokes the key and a later provisioning mints another.
Every key is written to a ledger before anything uses it and taken out only once this Connection names it, so a failure anywhere between minting and that write costs a key rather than leaving one live and unnamed: a queued key no Connection names is revoked by a sweep, which also drops the entries a Connection did take over.
A delete revokes every key the Connection names and every key still queued under it, and a revoke the key store could not complete fails the delete and removes nothing; the delete and a rotation of one Connection take the same lock, so neither acts on a key the other has just replaced.
The Agent holds only placeholders: `DAM_SERVER`, the HTTPS name of the install's own api-server Service, and `DAM_TOKEN`, the Connection's token placeholder ([addressing](#addressing-a-connection)).

Its contributions are that Service's name allowed under `/api/*` and injected under `/api/`, and the image's `dam` skill as a `file` contribution, so an Agent that holds the Connection reads it and one that does not never does.

**Which host.** The name is the api-server's own public Service, as the api-server learns it from `PLATFORM_APISERVER_URL`: the Agent dials it over HTTPS, its gateway terminates that TLS with the install's own leaf and [takes the request to that Service inside the cluster](credential-gateway.md#the-chain-to-the-installs-own-service).
So the route needs no public address of its own and works on every install, a plain-HTTP localhost one included — the leaf covers the name, and the DNS answer the machine gets for it is its gateway's, as for any host.
That name belongs to this Connection alone: any other Connection naming it is refused at create, and a gateway chain that carries this Connection's key takes its upstream port and CA from this Connection, never from a peer on the same name.

**When its key stops working.** A key the owner revokes by hand in Settings leaves the Connection reading expired, and the owner's own action puts it back: rotating mints a fresh key into the same Connection, keeping its id, its grants and every Agent's env.
Nothing mints a replacement by itself, so a key revoked on purpose stays revoked until someone asks for a new one.

**Who acts as the owner.** Granting it lets the Agent act as its owner, and the owner may still share that Agent or bind it to a chat: whoever can drive it then acts as the owner too (D257B), and each surface that decides it says so.

**The client's limits.** `dam` has the whole surface a person has, and every command acts as the owner.
The doors that open a live conversation or a shell — `dam chat`, `dam run`, `dam ssh`, a session's stream — pass their credential in a WebSocket's query string instead of in the header this Connection injects, so they stay the person's own and fail from inside an Agent.

## App preset: IBM LiteLLM proxy

The model-endpoint proxy that fronts models for IBM-internal use.
Which model provider an agent runs against follows from the Connection it is granted, not from harness configuration: the LiteLLM Connection contributes the env each harness reads for its base URL — including Bob's gateway URL — plus an inert key placeholder.
Bob is the case that needs more than a base URL.
It prefixes every gateway call with its own service path, and that prefix is not configurable, so the Connection also declares the prefix rewrite the gateway applies; the auth scheme needs no such treatment, because the gateway overwrites the credential header outright.
What the endpoint has to offer for this to work is the OpenAI-shaped chat-completion route, a model-information route reporting a non-empty model list (Bob treats an empty list as an error), and no region hint of its own — a gateway answering the profile route with one would redirect Bob's inference calls off the configured host.
Bob's built-in default resolves to a model only its own gateway serves, so the Connection pins Bob's model as it pins Codex's and Pi's; on a routed runtime the pin never reaches a harness process, since only the Bob Shell Connection's own settings reach one.
The [model catalog](harness-config.md#the-model-catalog) lists the endpoint's models under the Connection's alias, through the OpenAI model list since the key is refused the model-information route, and a session picks one per turn.
The [owner model catalog](owner-model-catalog.md) lists the same models without an agent, reading the stored key in the api-server itself.
Every harness reaches the endpoint through the [Model Router](harness-config.md#the-model-router), which sends the Connection's placeholder.
The endpoint caches a Claude prompt only when the request marks it: Claude Code marks its own, and the image's Pi extension marks Pi's.
GPT models cache on their own.

## App preset: CurveBender (own key)

A second LiteLLM proxy, fronting open models hosted on RITS rather than Claude and GPT.
An Agent can hold either proxy or both.
CurveBender uses the same routing and credential scheme, including Bob's prefix rewrite, aimed at its own host; its model defaults differ.
This is the user-keyed integration: the user connects it with their own CurveBender key, and Settings / Providers names it `CurveBender (own key)` so it cannot be confused with the deployment's own.
Where the deployment offers CurveBender, Settings / Providers lists the own-key row only to a user who already connected their own key.

Work runs on DeepSeek V4.1 Flash, which the Connection's work slots pin; Claude Code's non-reasoning permission classifier is the router's call, from the session provider's preferred classifier ([harness configuration](harness-config.md#the-model-router)), since a routed provider's env never reaches the harness beyond what its manifest claims.
The endpoint's model list names models but does not describe them, so the Connection supplies the deployment's window to the catalog, which Claude Code's per-model map and Pi read: 1,048,576 tokens, the `max_model_len` its own RITS router reports, which a live 270k-token prompt confirmed.
A smaller number compacts well below the real ceiling, and a larger one makes it compact too late and the endpoint refuses the call.
Pi also needs the reasoning capability and OpenAI-style reasoning effort: the endpoint ignores the switch GLM's own vendor API uses, so Pi's built-in description would be wrong here.
Pi applies these hints to every listed model.
Its stream can carry the end of thinking and the start of the answer in one piece, so the image's Pi extension preserves thinking-before-answer order.

## Deployment preset: CurveBender

The same proxy, reached with a key the deployment provides instead of the user's.
The install sets that key in its chart values (exact keys in [`helm/values.yaml`](../../helm/values.yaml)); without a key the preset does not exist, so the deployment offers no shared CurveBender and every user keeps their own.
It is not behind a feature flag: where the key is set, every user has it, and a user who connects nothing of their own still has a provider to run an agent on.
Such an install shows a CurveBender notice above every chat's composer, for every user: the coloured logo on a white tile, the page's own surface colours, a link to the documentation, and a close kept in this browser alone.
Its **Try now** button attaches the shared Connection and selects its work model — a fresh chat also moves to Pi, an open session keeps its harness — then thanks the person and links the community channel.
The composer never waits for a provider: an agent holding none takes this Connection before the prompt goes out, and only an install without the key keeps the block, whose composer opens the picker, or the provider list where the owner holds none, when clicked.
Until the agent's and the owner's provider lists are read, the composer waits, and says so when the read fails, so a send never plans on lists it has not read; a failed refetch over lists already read leaves it open.
With nothing to attach, a prompt the composer lets through goes out as it is, as to an agent whose harness brings its own model; it never returns to the composer.
The Connection is the deployment's, never the user's: the user's own Connection listing provisions it, and so does an agent create that would start on the default profile while the user holds none.
It follows the deployment's key, it is removed when the deployment drops the key, and the user's own create, update and delete refuse it.
It is named `CurveBender (shared)` and takes the first free name, then `LLM`, then that numbered from 2, when the user already holds one by that name.
Its row carries the preset's icon in a slightly deeper shade of its tile, so the two CurveBender rows read as related but are told apart at a glance, and it opens a read-only explainer rather than a form, since the user holds no key to enter.
Its Secret holds a copy of the deployment's key, which the gateway injects on these four path prefixes alone, the paths the runtime calls — `/v1/models` for the model listing, `/v1/messages` (with `/v1/messages/count_tokens` under it), `/v1/chat/completions` and `/v1/responses`.
The Connection allows CurveBender's host on every path and scopes only the key, because an egress rule matches by host and path glob, not by a credential's scope.
Each prefix is matched at a segment boundary, so `/v1/messagesX` is a path outside the scope, not a longer match ([credential-gateway](credential-gateway.md#path-scoped-chains-and-the-request-path)).
One key serves every user, and the gateway's scope keeps it off the rest of the proxy: the management routes (`/key/*`, `/user/*`, `/spend/*`), where a key that outlives its Connection could be minted, the shared key's spend read, or the key deleted for everyone, and the shared-identity routes (`/v1/files`, `/v1/batches`, `/v1/vector_stores`, `/v1/assistants`, `/v1/threads`, `/v1/memory`, `/v1/mcp/*`, `/v1/traces`, …), where every user's agent would read what another stored under the one identity the key names.
The user-keyed preset above keeps injecting on its host's every path, since the key is that user's own.
Bob never reaches this Connection through the gateway: the Model Router folds Bob's compiled-in `/inference` prefix inside the agent and calls `/v1/chat/completions`, so the deployment preset carries no `/inference` rewrite.
The scope is not evidence that the key itself is limited: the operator must still mint the deployment's key for inference only, with LiteLLM `allowed_routes: ["llm_api_routes"]`, so a path the gateway does not know about cannot manage keys or reach another user's stored state.
Calls are metered and attributed to the Connection that made them, and the key never reaches the agent or a browser.
Both CurveBender presets share one provider alias, `cb`, so their models are named alike and one Agent holds at most one of them.

## App preset: AWS Bedrock

Models an organization hosts in AWS Bedrock, authenticated with a **Bedrock API key**.
Such a key authenticates as a bearer token on both the Bedrock and Bedrock Runtime APIs, so this is an ordinary header Connection: the gateway overwrites `Authorization` with `Bearer <key>` on the region's runtime host, and the agent holds only a placeholder in `AWS_BEARER_TOKEN_BEDROCK`.
The region is a required input at connect time and decides that host — `bedrock-runtime.<region>.amazonaws.com` — so a Connection serves one region; it also lands in `AWS_REGION`.
The key is injected on the region's control-plane host too, `bedrock.<region>.amazonaws.com`, which the Connection names in `AWS_ENDPOINT_URL_BEDROCK`: that is where the region's inference profiles are listed, so an agent is offered only models Bedrock can invoke there.
That listing names the profiles that can be invoked from the region, each carrying a region prefix a bare model ID lacks, which is why a typed ID is the wrong unit to offer.
Models Bedrock also serves on demand under their bare ID are not in that listing, so they are not offered either; the Anthropic models a coding harness runs on are reachable only through a profile.
What no listing can say is whether the account has been granted a model: that is learned at the first call, as an error the turn reports.
The key check lists those profiles too, before the key is saved: Bedrock answers a wrong, malformed or expired key with a 403 that says so, which refuses it, and any other answer leaves it unverified, since a key may invoke models without the right to list profiles.
An optional model input becomes the provider's model pin.
The Connection also asks the harness's Bedrock client for HTTP/1.1, which every credential chain speaks by default.
IAM access keys and assumed roles are not accepted: Bedrock requires those to sign each request with SigV4, and the gateway's request signing serves S3-compatible storage only (below).

**Claude Code** and **Pi** run on it in their own Bedrock mode, through the Model Router ([harness configuration](harness-config.md#the-model-catalog)).
Pi is offered the inference profiles the control-plane host lists, but its image and video models, and runs them on its own Bedrock provider with the router as its Bedrock Runtime endpoint (`AWS_ENDPOINT_URL_BEDROCK_RUNTIME`).
The Connection's pinned model is always offered, and alone when the key may not list profiles.
Claude Code has Bedrock built in; its image switches it on whenever the key placeholder is present in a process the runtime did not mark as routed, and leaves model choice to Claude Code itself.
At start it resolves each of its model tiers to the region's profile, falling back to an earlier version, or from Opus to Sonnet, when the account cannot invoke the default; the platform pins no tier, which would lose that fallback.
The pin is a new session's default only, and Claude Code ignores it when the account cannot invoke it.

## App preset: S3-compatible storage

Shown to users as **Object Storage**.
A bucket on AWS S3, Cloudflare R2, IBM Cloud Object Storage, MinIO or Ceph, reached with an **HMAC key pair** the user pastes at connect time together with the HTTPS endpoint, a signing region (AWS needs the bucket's; IBM COS accepts any) and, optionally, one bucket.
S3 authenticates with SigV4 — the secret key signs each request and never travels — so this is the one Connection the gateway cannot serve by swapping a header value in: it **re-signs** the agent's requests with the real pair, and the agent never holds the keys ([credential gateway](credential-gateway.md#request-signing)).
The pair is proven by use before anything is stored — a check against the bucket when one is named, a bucket listing otherwise — so a wrong pair is refused at create, and again at rotation, where a refusal leaves the working pair in place.
The endpoint must be HTTPS on a DNS name: the gateway forwards plain HTTP without terminating it, so it could not sign there, and chains route on SNI, which clients do not send for an IP.
The key's upstream role is the real permission limit, which is why the template suggests a read-only key for read-only access.
A bucket, when given, narrows the egress rules and the gateway's signing to that bucket's paths on the endpoint; otherwise the whole host is allowed.
The build emits `egress-sign` for the endpoint and nothing else.

What the agent gets comes from the grant: **AWS profiles**, one per storage Connection the Agent holds, named after the Connection.
The credentials profile carries the Connection's token placeholder as the access key ID and a dummy secret key; the config profile carries the endpoint, the signing region, path-style addressing — the gateway's chain matches the endpoint host, so a bucket-as-subdomain request would miss it — and the client settings that keep uploads plain, which the signing step requires.
The platform sets `AWS_PROFILE` to the active profile and no key env at all, since key env overrides profiles.
The active profile is the grant the user marked **preferred** — an Agent's storage Connections are one preference group, whatever their endpoints — or, absent a choice, the earliest grant, re-asserted on every state push as gh's active account is.
Two storage Connections on one endpoint are both addressed through their placeholders, so they are grantable together, and the other profile acts as the other account.
The profiles are merged key-targeted into the user's own files, so a hand-written default profile survives beside them ([runtime delivery](runtime-delivery.md#driver-reconciliation)).

No S3 client ships in the images; the `platform-s3` skill every image carries, beside `platform-github`, tells the Agent to install one on demand, which profiles it holds and how to switch, that the keys it sees are placeholders, what the gateway's refusal of a streaming upload means, and what does not work: presigned URLs the agent makes (signed with the dummy key), clients that do not read AWS profiles without their own config, and endpoints the cluster cannot reach.

Rotation takes the pair: a new HMAC credential has a new access key ID too, so the update accepts both, re-proves them, and rewrites the Secret in place.
The gateway picks the new file up without a roll and the agent's placeholders are untouched.

## Custom Header credential

```jsonc
{
  "id": "conn-3f4a",
  "templateId": "custom-header",
  "name": "Internal billing API",
  "inputs": { "host": "billing.acme.internal", "headerName": "X-API-Key", "value": "…" },
  "auth": {
    "kind": "header",
    "valueRef":   { "secretName": "platform-secret-conn-3f4a", "key": "value" },
    "headerName": "X-API-Key",
    "valueFormat": "{value}"
  },
  "contributions": [
    { "kind": "egress-inject", "host": "billing.acme.internal",
      "headerName": "X-API-Key", "valueFormat": "{value}" }
  ]
}
```
