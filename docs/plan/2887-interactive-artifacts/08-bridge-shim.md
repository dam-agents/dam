# 08 — The bridge shim

**Depends on:** 06-self-refresh-limits
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

Publishing an interactive page today means hand-implementing the transport: catch
`artifact.connect`, keep `event.ports[0]`, mint a `ref`, match replies back to the ask that
started them. None of that is the page author's job, all of it can be got subtly wrong, and an
agent has no way to learn it. Asked to build an interactive page, an agent probes for
`window.claude`, `window.platform`, `window.artifact`, then goes looking through env vars and
`remote-settings.json` for an endpoint. The only thing that works today is pasting the protocol
into the prompt by hand, which means the feature is not usable by the person it was built for.

The renderer already wraps a page on the way out: HTML gets `<base target="_blank">`, JSX gets an
import map. A shim belongs in exactly that place.

After this slice the postMessage shapes are ours, not the page's. That is the point: the
transport becomes something we can change without breaking a published page.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Where it goes.**
   [`renderer.ts`](../../../packages/api-server/src/modules/artifact-library/viewer/renderer.ts).
   `renderHtmlInner` learns whether the page is interactive, and prepends the shim when it is.
   `getPreviewHtml` already reads the row, so it already knows. A non-interactive page must come
   out byte-identical to today.

2. **The whole public surface.**

   ```
   await platform.ask(action, payload?)   // resolves with the agent's result
   platform.onState(cb)                   // "sent" | "waking" | "queued" | "running"
   platform.ready                         // resolves once the app has handed over the port
   ```

   A refusal is a rejection carrying `{ reason, message }` from the pinned reason set. Three
   names, one of them rarely needed. That is what an agent has to learn.

3. **What the shim owns.** The connect listener, the `ref`, matching a reply to the promise that
   is waiting for it, and rejecting every outstanding promise if the port closes. An `ask` fired
   before the port arrives waits on `ready` rather than throwing, because a page that asks on
   load is the normal case, not an error.

4. **What the shim does not own.** One in flight is the app's rule and the server's rule. The
   shim does not queue, does not retry, and does not pace. It surfaces the refusal as a
   rejection and stops there. A shim that hides `busy` would hide the thing 06 exists to make
   visible.

5. **The tool description follows.** `create_artifact`'s `interactive` field describes
   `platform.ask` in a few sentences and stops. It must not describe the protocol, because after
   this slice the protocol is not the contract.

6. **The share viewer is untouched.** An interactive artifact can never be shared, so the shim
   only ever reaches the in-app preview.

7. **The pinned protocol moves first.** The README currently calls the postMessage shapes "the
   page's public API". They stop being that. Change the README before writing code, as the
   README asks.

## Acceptance criteria

- [ ] An agent told only what the `interactive` field says can publish a page that asks and
      renders an answer. No protocol in the prompt.
- [ ] `platform.ask` resolves with the agent's `result` and rejects with a named reason.
- [ ] An `ask` fired before the port arrives still lands.
- [ ] A page that never touches `platform` renders exactly as it does today.
- [ ] A non-interactive page's rendered bytes are unchanged.
- [ ] The experiments dashboard still receives its feed.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then by hand: ask an agent to publish an interactive page with
a button, telling it nothing about how the page talks to it. Confirm the page it writes works on
the first try. Then check the rendered source of a plain HTML artifact and confirm nothing was
injected into it.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
