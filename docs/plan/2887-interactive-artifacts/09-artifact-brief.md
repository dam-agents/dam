# 09 — The brief

**Depends on:** 08-bridge-shim
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

The Artifact Session cannot see the conversation the page was commissioned in. It starts cold
and is handed the request, plus the page's source on the first ask. Everything the agent knew
when it published the page is gone.

That is right, and it is also a trap. An agent asked for a page with a job to do, run this
interview, watch this deploy, keep this dashboard honest, has to plan for its own amnesia, and
nothing tells it to. The workaround today is to hide instructions inside the HTML, which only
helps an agent that already knows it must.

A brief closes it by asking. The tool has a field for what the future session will need, so the
agent fills one in, the way it fills in a title.

This is not the page source under another name. The source rides along once, on the first ask,
and describes what the page is. The brief rides every ask and says what to do about it.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Storage.** `library_artifacts.brief`, text, nullable, generated through
   `mise run db:generate`. Cap it at 8KB and say why in the refusal: it is charged to every turn
   the page ever causes, so it is a standing cost, not a one-off.

2. **Written at create, replaceable without a version.** `create_artifact` takes `brief`.
   `update_artifact` may replace it, and a brief-only update must **not** publish a new version:
   a version bump reloads the frame and destroys the state the brief exists to serve. Refuse a
   brief on a non-interactive artifact rather than storing one nothing will read.

3. **In the prompt.** [`artifact-request-prompt.ts`](../../../packages/api-server/src/modules/artifact-library/domain/artifact-request-prompt.ts)
   puts it directly after the opening line, before the request itself, named as what the page's
   author left for this moment. Every ask, not just the first. That is the whole difference
   between it and the source.

4. **Readable back.** `get_artifact` returns it, so an agent serving an ask can see what it told
   itself, and so it can be refined rather than guessed at again.

5. **Visible to the owner.** It appears in the artifact's source view, not in the preview chrome.
   A person asking "why does my page keep doing that" is owed the instructions driving it, and
   the answer must not require a database.

6. **The pinned contract moves first.** The README's Postgres block gains the column and the
   tRPC block gains the field. Change the README before writing code.

## Acceptance criteria

- [ ] A brief set at create reaches the agent on every ask, including the first.
- [ ] Replacing a brief does not publish a new version and does not reload an open page.
- [ ] A brief on a non-interactive artifact is refused with a reason.
- [ ] A brief over the cap is refused with a reason that names the cap.
- [ ] `get_artifact` returns the brief; the source view shows it.
- [ ] An artifact with no brief behaves exactly as it does today.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then by hand: ask an agent to publish an interactive page that
interviews you about something, in one sentence, saying nothing about sessions or briefs. Confirm
it writes a brief, and that the second ask is answered in the same character as the first without
you re-explaining. Then delete the agent's session from the pod, ask again, and confirm the cold
session still knows its job.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
