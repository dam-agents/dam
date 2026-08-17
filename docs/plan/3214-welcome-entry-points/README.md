# Welcome new users and let them choose how they enter

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** [#3214](https://github.com/dam-agents/dam/issues/3214)

## Goal

A user who opens the platform with nothing in it gets a short welcome and three ways in — a sandbox, an experiment, or a knowledge base. Each choice takes them straight into that creation flow, so the first click produces something. The choice is recorded, so we can report the split of what new users pick.

Today that user is redirected into the create-sandbox wizard on first load and is never asked. Nothing tells them what the platform is for, and nothing records how they started.

## Approach

**No modal.** The issue is written around the first-run modal, but the accepted design puts the three entry points on the **empty Home** instead — see `jamiejabbouribm`'s prototype comment on #3214, confirmed by `jenna-winkler` on #3190 ("proposing home page empty state for these cards over dismissible modal"). There is no welcome modal in the codebase to change; the surface is `ListView`'s empty state.

**The hero replaces the current empty state.** `packages/ui/src/modules/agents/views/list-view.tsx` renders `PageEmptyState` ("No sandboxes yet") when the user owns no agents. That block becomes the welcome hero: heading, the value paragraph approved on #3190, the three cards, and a documentation link. Once the user owns anything, Home is the sandbox list exactly as it is now.

**The cards reuse the wizard's existing starting points.** All three destinations already exist — `navigateToCreateSandbox()`, `navigateToCreateSandbox("experiment")`, `navigateToCreateSandbox("knowledge-base")` — and the wizard's step 1 (`starting-point-step.tsx`) already names and icons them. The cards are a shortcut into that flow, not a new flow.

**The first-run redirect goes.** `use-first-run-redirect.ts` sends a user with zero agents straight to the wizard, which would hide this feature completely. The hook and its call in `app.tsx` are deleted. This is a behavior change the issue does not mention — it is called out in the PR body.

**Recording rides the usage-tracking subsystem.** See [`docs/architecture/usage-tracking.md`](../../architecture/usage-tracking.md). The api-server emits a domain event, the `persist-activity` saga writes one `activity_events` row, and SQL views expose the split to the inspector report. Existing events do **not** cover this: there is no such event type, and the `agents` mirror stores no kind.

Two things make this a first, and both are deliberate:

- Every activity event today is a server-side domain fact (a login, a channel turn, a schedule fire). This one is a UI click reported by the UI.
- That architecture page frames the subsystem as operator-facing, "not product-analytics". A card-click event is product analytics. The page is updated in sub-issue 01 to say so.

**Pinned contract** — sub-issue 02 codes against this without reading 01's implementation:

```ts
usage.entryPointChosen({ choice: "sandbox" | "experiment" | "knowledge-base" }) → void
```

Fire-and-forget from the UI: the call is started, navigation happens immediately, and a failure is silent. Recording a choice must never delay or interrupt the user.

## Sub-issues

| #   | Title                                    | Scope                                                                                                                    | Depends on |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 01 ✅ | Record the entry-point choice          | Domain event, `usage` tRPC module and service, `persist-activity` subscriber, two reporting views, architecture-doc update | —          |
| 02  | Welcome the new user on the empty Home    | The hero and three entry cards on Home's empty state; removal of the first-run redirect                                   | 01         |

## Conventions & glossary

- **Entry point** — one of the three ways into the product offered on the empty Home. **Choice** — which one the user picked: `sandbox`, `experiment`, or `knowledge-base`. These three strings are the contract; they appear in the tRPC input, the domain event, the `activity_events` payload, and the views.
- **Surface** for these rows is `"ui"`, matching what `emitUserAuthenticated` records for browser traffic.
- Card copy is the prototype's, verbatim: "Create a coding agent", "Begin an experiment", "Start a knowledge base". This was a deliberate decision over product vocabulary ("sandbox"); do not "fix" it.
- The brand is never hardcoded. The heading reads the brand name through `getBrand()` ([`packages/ui/src/brand.ts`](../../../packages/ui/src/brand.ts)).
- No code comments, except the registered typed prefixes. Run `mise run common:check:comment-types` after editing code. A hand-written SQL migration keeps its top comment explaining *why* — with no ADR reference.
- Apply the `/typescript-engineering` skill in sub-issue 01 and the `/react-ui-engineering` skill in sub-issue 02.
- `mise` runs everything. Never call `pnpm`, `tsc`, `eslint`, `drizzle-kit`, `kubectl`, or `helm` directly.

## Whole-feature smoke test

On a cluster with both slices deployed (`mise run cluster:upgrade`), signed in as a user who owns nothing:

1. Home shows the hero, the three cards, and the documentation link — not the wizard, and not "No sandboxes yet".
2. Each card lands in the create-sandbox wizard with the matching starting point selected (none for the first card, "Experiment sandbox" for the second, "Knowledge base sandbox" for the third).
3. Leave the wizard without creating anything. Home still shows the hero.
4. In the browser console, `platformUsage.openReport()` — the report lists the two entry-point views, and the rows show one choice per card that was clicked, including the abandoned one.
5. Create a sandbox. Home returns to the sandbox list; the hero is gone.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for [#3214](https://github.com/dam-agents/dam/issues/3214).
