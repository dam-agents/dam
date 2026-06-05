# /v2 Sandbox UI

Shell-less, parallel entry point at `/v2`. v1 stays. Internal demo. Reuses v1 data models wholesale; "sandbox" is v2-only copy over the existing `agent` types and APIs. Terminal-only (no ACP/chat/approvals). LLM via provider-secrets, GitHub via connections.

**Status: implemented and deployed to the local dev cluster.** Served over HTTP at `http://platform.localhost:4444/v2`. Verified via type-check, lint, and the OAuth unit test, plus an HTTP smoke check. Not yet committed.

## Settled design

- No sidebar. List shows status + name cards (click opens terminal), keeps trash with confirm, no refresh (keeps the 5s poll), no power button (terminal auto-wakes), plus a placeholder "create" card. A minimal degraded indicator stays; the verbose installs-failed badge was dropped.
- Creation is in-place full-screen at `/v2/new`, two wizard steps (cancel/back) plus the terminal route.
  - Step 1: name + LLM (Anthropic OAuth / Anthropic API / IBM LiteLLM, in that order). Inline-created via provider-secret create, verified (Anthropic only), reuse-if-exists. The credential UI renders inside the selected provider card.
  - Step 2 (optional): GitHub and GitHub Enterprise as two independent connections — connect either, both, or neither. OAuth runs in a popup; every authorized connection is granted.
  - Terminal: full-screen Claude Code terminal at `/v2/<id>`, breadcrumb back to the list, the terminal's own "Connecting…" overlay covers the auto-wake.
- Agent CR is created at the step-2 to terminal transition (claude-code template, egress trusted, other fields defaulted) as a single create call that also grants the LLM secret and any GitHub connections. Cancelling before that leaves no pod.

## Key findings that shaped the build

- The connections / contributions subsystem is already fully implemented despite its architecture doc banner saying "Proposed". GitHub support is therefore UI-only on existing APIs.
- The create-agent mutation already grants provider secrets and app connections in one call, so the step-2 to terminal transition is a single mutation, not three.
- OAuth was reworked from full-page redirect to popups with postMessage (see step 2).

## What was built

1. Backend [x]
- [x] Dynamic OAuth return: a `returnTo` is threaded through the OAuth pending-context keyed by state; the callback redirects there instead of the hardcoded connections view. Same-origin relative paths only (sanitized). The registered GitHub callback URL is untouched. v1's connections view still uses this redirect path.
- [x] Popup OAuth mode: a `popup` flag on the pending-context makes the callback return a small page that postMessages the result to the opener and closes, instead of redirecting. Used by the v2 popup flow; v1 redirect behaviour is unchanged.

2. Routing and layout [x]
- [x] Custom router extended: `/v2` (list), `/v2/new` (wizard), `/v2/<id>` (terminal), with browser back/forward handled.
- [x] Shell-less v2 layout (no sidebar or mobile nav), a thin breadcrumb header. Auth and terms gates are inherited at app entry, same as v1.

3. List view [x]
- [x] Reuses the existing agents query (5s poll retained). Cards restyled to status + name; click opens the terminal; trash kept with a confirm; refresh / power / configure dropped.
- [x] A minimal "Some setup didn't apply" line shows when an agent has contribution failures; the verbose badge was dropped.
- [x] Placeholder "create sandbox" card opens the wizard.

4. Creation wizard [x]
- [x] In-place full-screen wizard with breadcrumbs and cancel/back.
- [x] Step 1: name + LLM picker; inline provider-secret create; verify-before-advance for Anthropic (the existing verify endpoint), create-and-trust for LiteLLM; reuse-if-exists matched on secret type plus identifying env var (so Anthropic API and Anthropic OAuth don't collide). The credential field, the reuse line, and the "credential ready" state all render inside the selected provider card.
- [x] Step 2: GitHub and GitHub Enterprise as independent, parallel connections (host field for GHE; client ID/secret only when the template requires bring-your-own-app). Connection create + start OAuth in a popup; result via postMessage flips the right card to "Connected"; the other authorize button disables while one popup is in flight. Reuse by template id (and host for GHE). If the popup is blocked, it falls back to the full-page redirect flow.
- [x] sessionStorage wizard snapshot (ids and pick-state, no secrets) persists across the redirect fallback and rehydrates on return; the popup path keeps the wizard mounted so no reload is needed.
- [x] On the step-2 to terminal transition: a single agent create (claude-code template, egress trusted) granting the LLM secret and every authorized GitHub connection, then navigate to the terminal.

5. Terminal step [x]
- [x] Reuses the terminal component full-screen, keyed per agent for a fresh session. Its built-in "Connecting…" overlay covers the relay's auto-wake; breadcrumb returns to the list.

## Resolved questions

1. IBM LiteLLM verify — skipped. No verify path exists today and LiteLLM is create-and-trust; not worth building for an internal demo.
2. GHE naming — support several. Connections are reused by template id plus host, and the connection name is host-keyed, so multiple GHE hosts don't collide. GitHub.com and GHE are connectable in parallel.
3. v2 card — kept a minimal degraded indicator; dropped the verbose installs-failed badge.
