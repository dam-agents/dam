# 02 — UI: render the named cause, never raw text

**Depends on:** 01-classify-scan-failures
**Part of:** Skill source scan errors name their cause — see [README](./README.md)

## Context

The source card currently renders whatever string reached it, on one line. This slice makes it
render the structured `ScanFailure` from slice 01 in the design's two-line form, and — the part
that actually fixes the screenshot — substitutes an honest generic failure whenever a response
carries no `ScanFailure` at all. That absence is exactly the transport case: an HTML body from
`/api/trpc` that never went through the server's classifier. See the
[README](./README.md#what-the-investigation-found--read-this-before-implementing) for why that
is where the reported string comes from.

Apply the [`/react-ui-engineering`](../../../.agents/skills/react-ui-engineering/SKILL.md) skill.
Run `mise run lint:fix` after editing.

## Implementation plan

1. **Read the design.** The target is the second screenshot on
   [#3236](https://github.com/dam-agents/dam/issues/3236#issuecomment-5223275268): inside the
   existing tinted danger strip, an outline alert icon at the left, a **bold** title on the first
   line, the detail line beneath it aligned to the title (not to the icon), and "Manage
   connections" right-aligned on the title's row. The card layout above the strip is unchanged.

2. **Add the client-side classifier.** New file `packages/ui/src/lib/scan-failure.ts`:

   ```ts
   /** The card renders only failures the server named. Anything else — a transport
    *  error, an HTML body from a gateway, a shape we don't recognize — becomes this
    *  generic pair, so a parser's complaint can never reach a user. */
   export function toScanFailure(err: unknown): ScanFailure;
   ```

   Read `err.data.scanFailure` off the `TRPCClientError` and validate it with
   `scanFailureSchema.safeParse` (imported from `api-server-api` — slice 01 made the schemas file
   browser-safe). On any miss, return the UI's own generic pair: title "Couldn't scan this
   source", detail "Something went wrong reading this repository. Try re-scanning in a moment."
   Do **not** call `getErrorMessage` on this path — reaching for the raw message is the defect.

3. **Change what the hook stores.** In
   [`use-skills-surface.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-skills-surface.ts):
   `errorBySource` becomes `Record<string, ScanFailure | null>` on both the `SkillsSurface`
   interface (~line 32) and the `useState` (~line 111), and `loadSkills`'s catch (~line 145) sets
   `toScanFailure(err)` instead of `getErrorMessage(err, "Failed to load skills")`. There is
   exactly one consumer of `errorBySource`, so the change is contained. Leave the other `catch`
   blocks in this hook alone — they are a separate concern.

4. **Restyle `SourceError`.** In
   [`skill-source-card.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skill-source-card.tsx):
   `SourceError` takes `failure: ScanFailure` instead of `error: string`. Render `WarningAlt`
   from `@carbon/icons-react` (the icon already used for this tone elsewhere in the UI), the
   title in `font-semibold`, and the detail below it. Keep the existing
   `border-t border-border bg-danger-light text-danger` strip and the `onManageConnections`
   button unchanged — it already calls `navigateToSandboxHome(agentId, "connections")`
   ([`skills-surface.tsx`](../../../packages/ui/src/modules/sandboxes/components/skills/skills-surface.tsx)),
   which is what the design comment asks for. Update the card's `error` prop type to match, and
   the `{error && …}` render (~line 239).

   **Drop the `parsePlatformCta` branch from `SourceError`.** Its "Fix it →" affordance depended
   on a `connect_url` from an `app_not_connected` envelope, and nothing in this repo produces
   that any more. Leave `packages/ui/src/lib/platform-cta.ts` and its publish-flow caller in
   place — this removes one dead branch, not the helper. Confirm no other scan-path caller relies
   on it before deleting.

5. **Pass it through.** In `skills-surface.tsx`, the `error={errorBySource[src.id] ?? null}` prop
   needs no logic change — only the type follows.

6. **Gate "Manage connections" on the verdict.** Found while smoke-testing slice 01: the card
   renders that affordance for *every* error, so a GitLab clone failure (`other`) and a stopped
   sandbox (`agent_unreachable`) both invite the user to go fix their connections, which will not
   help. Show it only for `needs_github_connection` and `repo_unreachable`. The UI's own
   transport fallback carries no code the user can act on either — leave it off there too.

## Acceptance criteria

- [ ] An errored source card shows an alert icon, a bold cause line, a detail line, and
      "Manage connections" on the title's row, matching the design screenshot.
- [ ] Clicking "Manage connections" lands on that sandbox's Connections tab.
- [ ] A response with no `data.scanFailure` renders "Couldn't scan this source" — the string
      `Unexpected token` cannot appear on a source card under any failure.
- [ ] No component on this path calls `getErrorMessage` on a scan error.
- [ ] `SourceError` no longer renders the `platform-cta` "Fix it →" branch, and
      `platform-cta.ts` still exists for its publish-flow caller.
- [ ] "Manage connections" appears only on the two connection-related verdicts, not on
      `agent_unreachable`, `other`, or the client-side fallback.
- [ ] `mise run check` and `mise run lint:fix` are clean.

## Smoke test

Build and load both images, then walk the whole-feature smoke test in the
[README](./README.md#whole-feature-smoke-test):

```bash
mise run cluster:build-apiserver && mise run cluster:build-ui
```

The decisive step is the last one. With the Skills page open, stop the api-server pod
(`mise run cluster:kubectl -- delete pod -l app=platform-apiserver`) and hit "Re-scan" on a
source while it is down: the card must read "Couldn't scan this source", never a parser message.
Restore it by waiting for the pod to come back, then re-scan to confirm the list returns.

Traps: the dev app is `http://localhost:4444` (https 404s at Traefik); after `build-ui` the
service worker can serve a stale bundle — check the loaded script before concluding a change did
not apply; another worktree's vite may own 5173. Always click "Re-scan" rather than reloading —
the scan cache holds the previous verdict for five minutes.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
