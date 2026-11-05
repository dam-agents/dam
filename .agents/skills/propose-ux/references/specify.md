# Specify the chosen concept

Goal: give the builder a flow that has no unanswered question about states, errors, words and surfaces.

## What the spec holds

1. **The flow.**
   Number the steps, and draw the branches in Mermaid.
2. **The states of each screen or surface.**
   List the states that apply: empty, loading, working, partial, error, done, and no permission.
   Every state has a way out.
   Name the combinations that cannot happen, and say how the design prevents them.
3. **The errors.**
   Prevent first.
   When an error still happens, say what happened, what it affects and what to do.
   Give a path that recovers.
4. **The words.**
   Use "Words users read" in `docs/ubiquitous-language.md`.
   A confirm dialog repeats its action in the button.
   An empty state says what will be here and gives the one action that fills it.
5. **The surfaces.**
   Cover the web UI, the `dam` CLI, Slack, Telegram, GitHub and shared pages.
   For each one, say what the person sees, or say that the surface is out of scope.
   Channel copy follows the channel pages in `docs/architecture/`.
   Copy never holds the brand as a literal.
6. **The components.**
   Name the existing component for each part and its size.
   Where no component fits, say what is new and why no existing one works.
   A Figma frame decides the size.
   Without one, reuse the size of the existing component, or ask for the numbers.
   Never take a size from a screenshot.
7. **The look.**
   Both themes ship, so say what changes in each.
   Every control works with a keyboard, shows focus, and does not rely on color alone.
   An icon-only control has a tooltip and an accessible name.

## Check the spec

Walk the spec twice: as a first-time person and as a returning one.
Review it against Nielsen's ten usability heuristics and the design rules in `PROFILE.md`.
Write each finding with its severity.

| Severity | Meaning                   |
| -------- | ------------------------- |
| 1        | Cosmetic                  |
| 2        | Minor problem             |
| 3        | Major problem             |
| 4        | Must fix before the build |

Fix severity 3 and 4 before you show the spec.
When a fix changes what the person does, go back to the choice and ask the user again.
List the rest.
Do not write a finding that is not a real problem.

## After it ships

Name the signal that shows the change works: a usage analytics panel or an activity event.
If no such signal exists, say so.

## What must change with it

List these at the end of the proposal:

- The journeys and helpers in `.quality-inspector/qi-profile-dam/` that use a flow, a label, a dialog or an API that the spec changes.
- The part of `.design-desk/dam/` that a moved screen or a new role of a `packages/ui` folder changes.
- The architecture pages whose behavior the spec changes.
- The words that the glossary needs.
