# 06 — Self-refresh limits and the indicator

**Depends on:** 05-browser-bridge
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

A page may refresh itself, and the agent wrote that timer, not the person looking at it. The
server cap from 02 stops runaway spending; this slice stops a forgotten tab from holding an
agent awake and eating a seat in the owner's ceiling, and makes the spending visible.

## Implementation plan

Apply the `/react-ui-engineering` skill. Everything here is client-side pacing on top of rules
the server already enforces; do not re-implement the cap in the browser, and do not weaken it.

1. **Trigger kind.** Automatic requests send `trigger: "auto"`, ones a person made send
   `"user"`. This
   is what keeps timers out of the activity log, so it must be decided from a real user gesture,
   not from a heuristic.
2. **Pacing.** Refuse an automatic request less than 30 s after the previous one, locally, so the
   server cap is a backstop rather than the everyday path.
3. **Visibility.** Pause automatic requests while the document is hidden and resume on return.
4. **Idle stop.** Stop them entirely after 30 minutes with no human interaction with the page,
   and say so. Any interaction starts them again.
5. **Indicator.** A chip on the panel while a page refreshes itself, naming what is happening
   and offering pause. This is the answer to "why is my agent awake", so it must be visible
   without opening anything.

## Acceptance criteria

- [ ] An automatic request sends `trigger: "auto"` and a clicked one sends `"user"`.
- [ ] Automatic requests closer than 30 s apart do not reach the server.
- [ ] Hiding the tab pauses them; showing it resumes them.
- [ ] After 30 idle minutes they stop, the chip says so, and interaction restarts them.
- [ ] Pausing from the chip stops them immediately.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then by hand: open a page that refreshes itself, confirm the
chip appears and the requests land no more often than every 30 s. Switch tabs and confirm they
stop, switch back and confirm they resume. Leave it idle past the timeout and confirm it stops
and says why. Check the activity log shows only the requests you made yourself.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
