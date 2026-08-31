---
name: platform-artifacts
description: >
  Publishing work for a human to see, through the platform artifact library
  (`create_artifact`). REQUIRED before writing any page that must hand something
  back to you — a form to submit, choices to record, a Refresh button, an answer
  to work on. Such a page is published with `interactive: true`, and this skill
  is the only place its page API (`platform.ask`) and design rules are written
  down — no tool description repeats them.
---

You are running inside a Platform agent pod. `create_artifact` can publish an HTML
page that calls back to you: a button on the page asks you to do something, and your
answer lands in the page without a reload. This skill carries everything you need to
write such a page.

## First: is the feature on?

If `answer_artifact_request` is not among your platform MCP tools, interactive
artifacts are off for this owner. Build a static page and stop reading —
`create_artifact` refuses `interactive: true` while the feature is off.

## Publishing one

Set `interactive: true` on `create_artifact`. HTML only. It is settled at create — no
later version can turn it on or off — and the artifact can NEVER be shared, because
the page drives an agent that runs with its owner's credentials. Publish a separate
artifact if you want a shareable copy.

## The page API

The platform injects `window.platform` into every interactive page. No setup, no
script tag — write the page against these calls and nothing else:

```js
await platform.ask(action, payload?)  // resolves with your answer
platform.onState(cb)                  // "sent" | "waking" | "queued" | "running"
await platform.ready                  // the app has connected the page
```

- `platform.ask(action, payload?)` — `action` is a short string naming what was asked
  (`"refresh"`, `"save_answer"`); `payload` is an optional plain object with its
  arguments. The promise resolves with whatever you pass to `answer_artifact_request`,
  or rejects with an `Error` carrying `{ reason, message }`.
- `platform.onState(cb)` — progress of the ask in flight, for a waiting indicator.
  Returns an unsubscribe function.
- `platform.ready` — resolves once the app is listening. `platform.ask` waits for it
  on its own; await it only to gate page UI, e.g. enabling buttons.

Refusal `reason`s. The page renders its own copy for each:

| reason                             | meaning                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `busy`                             | an ask is already in flight — one at a time per page                                                         |
| `rate_limited`                     | over 60 asks on this page in the last hour                                                                   |
| `not_bound`                        | nothing has asked through the page from a conversation yet, and no conversation is open behind it now        |
| `wake_failed`                      | the agent could not be woken                                                                                 |
| `over_budget`                      | the owner's budget is exhausted                                                                              |
| `expired`                          | nothing answered within 15 minutes                                                                           |
| `cancelled`                        | the person stopped waiting                                                                                   |
| `agent_deleted`, `session_deleted` | the agent, or the conversation the page asks in, is gone — the page stays readable, its asking days are over |

Do not queue, retry, or pace asks in the page. One in flight is the platform's rule,
and `busy` reaches the page as a rejection like any other.

## Design rules for a page that asks

- **Every ask is a full turn of yours** — slow and paid for. Build the page as many
  small asks, one per step, each rendering its own answer in place — not one form
  that submits everything at once and makes the person wait for all of it.
- **Send only what changed in `payload`.** Every ask reaches a session that already
  holds the asks before it; a page that replays its whole history in every ask pays
  for that history again on every turn.
- **Asks land in the conversation the page is bound to** — pinned by the first ask
  made with a conversation open, usually the very chat you publish the page in. Its
  questions and answers appear there.
- **Shape your answers for the page.** The page reads `result` with its own code, so
  decide the shape while writing the page and answer in that shape.

## Worked example

A page with a Refresh button that shows the time as you report it:

```html
<!DOCTYPE html>
<html>
  <body>
    <button id="refresh">Refresh</button>
    <p id="out">Press Refresh.</p>
    <script>
      const out = document.getElementById("out");
      document.getElementById("refresh").onclick = async () => {
        out.textContent = "…";
        try {
          const { time } = await platform.ask("refresh");
          out.textContent = time;
        } catch (err) {
          out.textContent = err.message; // err.reason names why
        }
      };
    </script>
  </body>
</html>
```

Each press wakes you with a prompt naming the request. You answer with
`answer_artifact_request({ request_id, result: { time: "..." } })` and the page
renders it in place.
