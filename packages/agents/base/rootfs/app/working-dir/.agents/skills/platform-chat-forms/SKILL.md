---
name: platform-chat-forms
description: >
  Show rich UI directly in the platform's web chat — forms, choices, confirmations, cards, lists, tabs, dialogs, callouts, diffs — written as an A2UI v1.0 block in your reply.
  Use it when you need structured input from the user (onboarding answers, which kit update changes to take, picking options, dates, amounts) or when a card, list or diff presents a result better than prose.
  Do not use it in Slack or Telegram turns, and never to ask for passwords, tokens or keys.
---

The web chat renders an A2UI v1.0 block in your reply as native UI.
Write normal text first, then the block, then end your turn.
The user's answer arrives as their next message.

## Only where the chat says it renders forms

Use a block only when the conversation carries renderer capabilities: an `<a2ui-capabilities>` block in the user's latest message or in the briefing that opened the session, for example `{"v1.0":{"supportedCatalogIds":["urn:platform:a2ui:catalog:chat:v1", …]}}`.
The web chat adds it to every message while the user has Chat forms turned on.
Without it — Slack, Telegram, a user who has the feature off — ask in plain text.
Use only the catalogs it lists.

## Format

Start the block on a line of its own with `<a2ui-json>` and end it with `</a2ui-json>`.
Do not put it in a code fence; a tag in the middle of a line is shown as plain text.
The block holds one JSON array of A2UI messages.
Every message carries `"version": "v1.0"`.

Usually one message is enough: `createSurface` with the components and the initial data model inline.

```
{"version": "v1.0", "createSurface": {
  "surfaceId": "kit-update-7f3a",
  "catalogId": "urn:platform:a2ui:catalog:chat:v1",
  "components": [ {"id": "root", ...}, ... ],
  "dataModel": { ... }
}}
```

- `surfaceId` must be unique in the conversation.
  Creating an id that exists is an error; use a fresh id (add a short random suffix) for every new form.
- Components are a flat list.
  The one with `"id": "root"` comes first, and a parent comes before its children (the chat renders them as they stream).
  Children are referenced by id, never inline.
  Each component has one parent; to repeat one, use a list template.
- `catalogId` picks the components and functions you may use:
  - `urn:platform:a2ui:catalog:chat:v1` — everything below, including `Callout`, `Badge`, `Switch`, `CodeBlock` and `Diff`.
    Use this one.
  - `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json` — the A2UI basic catalog only.
- Optional: `"sendDataModel": true` makes the chat attach the whole data model of the form to every later user message (see "What comes back").
- Optional: `"metadata"` locks the chat input while the form waits (see "Lock the chat input").

## Values, bindings and functions

A property is a literal, a binding, or a function call:

- `{"@path": "/form/email"}` reads the data model.
  Inside a list template, a path without a leading `/` is relative to the item (`{"@path": "name"}`).
- `{"@call": "formatString", "args": {"value": "Hello ${/user/name}"}}` calls a catalog function.
  Arguments are named and may themselves be bindings or calls.

Functions (all run in the chat, none can be called by you):

| Function           | Args                                                                             | Result                               |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------ |
| `formatString`     | `value` with `${/path}`, `${relative}`, `${fn(arg: value)}`; `\${` for a literal | string                               |
| `formatNumber`     | `value`, `decimals`, `grouping`                                                  | string                               |
| `formatCurrency`   | `value`, `currency` (ISO 4217), `decimals`, `grouping`                           | string                               |
| `formatDate`       | `value`, `format` (TR35: `yyyy MM dd EEEE HH:mm h a`…)                           | string                               |
| `pluralize`        | `value`, `zero`, `one`, `other`, …                                               | string                               |
| `required` `email` | `value`                                                                          | validation result                    |
| `regex`            | `value`, `pattern`                                                               | validation result                    |
| `length`           | `value`, `min`, `max`                                                            | validation result                    |
| `numeric`          | `value`, `min`, `max`                                                            | validation result                    |
| `and` `or`         | `values` (list)                                                                  | boolean                              |
| `not`              | `value`                                                                          | boolean                              |
| `openUrl`          | `url` (http/https)                                                               | opens a tab; only as a button action |
| `@index`           | `offset`                                                                         | position inside a list template      |

## Components

Any other component or property makes that part of the form fail.

| Component       | Properties                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Column`, `Row` | `children`; `justify`: `start` `center` `end` `spaceBetween` `spaceAround` `spaceEvenly` `stretch`; `align`: `start` `center` `end` `stretch`                                                                                                                                               |
| `List`          | `children`; `direction`: `vertical` (default) or `horizontal`; `align`                                                                                                                                                                                                                      |
| `Card`          | `child`: one id (wrap several in a `Column`)                                                                                                                                                                                                                                                |
| `Tabs`          | `tabs`: `[{"title", "child"}]`                                                                                                                                                                                                                                                              |
| `Modal`         | `trigger`: id of a `Button` that opens it; `content`: id shown in the dialog                                                                                                                                                                                                                |
| `Divider`       | `axis`: `horizontal` (default) or `vertical`                                                                                                                                                                                                                                                |
| `Text`          | `text` (Markdown: `## Heading`, `**bold**`, lists); `variant`: `body` (default) or `caption`                                                                                                                                                                                                |
| `Icon`          | `name`: `check` `warning` `error` `info` `help` `settings` `lock` `lockOpen` `folder` `mail` `event` `calendarToday` `person` `search` `refresh` `add` `edit` `delete` `download` `upload` `send` `share` `star` `notifications` `visibility` `arrowBack` `arrowForward` … or `{"svgPath"}` |
| `Image`         | `url` (https); `description`; `variant`: `icon` `avatar` `smallFeature` `mediumFeature` `largeFeature` `header`; `fit`                                                                                                                                                                      |
| `Video`         | `url` (https); `posterUrl`                                                                                                                                                                                                                                                                  |
| `AudioPlayer`   | `url` (https); `description`                                                                                                                                                                                                                                                                |
| `TextField`     | `label`; `value`: binding; `placeholder`; `variant`: `shortText` `longText` `number` `obscured`; `checks`                                                                                                                                                                                   |
| `CheckBox`      | `label`; `value`: binding to a boolean; `checks`; for consent or a pick, not a setting                                                                                                                                                                                                      |
| `ChoicePicker`  | `label`; `options`: `[{"label", "value"}]`; `value`: binding to a list of strings; `variant`: `mutuallyExclusive` (default) or `multipleSelection`; `displayStyle`: `checkbox` or `chips`; `filterable`; `checks`; more than four exclusive options without `chips` show as a dropdown      |
| `Slider`        | `label`; `min`; `max`; `steps` (number of divisions); `value`: binding to a number; `checks`                                                                                                                                                                                                |
| `DateTimeInput` | `label`; `value`: binding to an ISO 8601 string; `enableDate`; `enableTime`; `min`; `max`; `checks`                                                                                                                                                                                         |
| `Button`        | `child`: id of a `Text`; `variant`: `primary` `default` `borderless`; `action`; `checks`                                                                                                                                                                                                    |
| `Callout`       | `text` (Markdown); `title`; `tone`: `neutral` `info` `success` `warning` `danger`, a literal or bound                                                                                                                                                                                       |
| `Badge`         | `text`; `tone`, a literal or bound (per row in a template)                                                                                                                                                                                                                                  |
| `CodeBlock`     | `code`; `language`                                                                                                                                                                                                                                                                          |
| `Diff`          | `diff` (unified diff text); `title`                                                                                                                                                                                                                                                         |
| `Switch`        | `label`; `description`; `value`: binding to a boolean; `checks` — a setting the user turns on or off                                                                                                                                                                                        |

Every component also takes `weight` (share of space in a `Row`/`Column`) and `accessibility`: `{"label", "description", "live", "hidden"}`.

`children` is a list of ids, or a template that repeats one component for each item of a list: `{"componentId": "row_tpl", "path": "/connections"}`.

**Checks** validate inputs: `"checks": [{"condition": {"@call": "required", "args": {"value": {"@path": "/team"}}}, "message": "Enter the team name"}]`.
An input shows its messages once the user edits it.
A `Button` with checks is disabled while any check fails — put the form's rules on the submit button.

**Actions**: `{"event": {"name": "save", "userMessage": "Saved the settings", "context": {"team": {"@path": "/team"}}}}` sends the event to you; `{"functionCall": {"@call": "openUrl", "args": {"url": "https://…"}}}` runs in the chat.
`userMessage` is what the user sees in their message.

## Updating a form later

In a later reply you can change a form you created earlier: send `updateComponents` (replaces components by id) and `updateDataModel` (`{"surfaceId", "path": "/status", "value": "Applied"}`; `"value": null` deletes the key) with the same `surfaceId`.
The form re-renders where it is and becomes the active one again.
`deleteSurface` removes it.
Only the form the newest reply created or updated accepts input; older ones are locked.

## What comes back

The user's message carries renderer messages in `<a2ui-message>` blocks:

```
<a2ui-message>
{"version":"v1.0","action":{"name":"save","userMessage":"Saved the settings","surfaceId":"onboarding-2c1d","sourceComponentId":"save","timestamp":"…","context":{"team":"Platform"}}}
</a2ui-message>
```

- `action` — a button was pressed: act on `name` and `context`.
- `error` — the user sent you a rendering error (`code`, `message`, `path`): fix the block and send it again with a new `surfaceId`.
  If the chat reports an error for a block you already fixed once, send no third block: ask the same questions in plain text, as a numbered list with the options and your recommendation.
- `rendererFunctionResponse` — the answer to a `callRendererFunction`.
  You do not need it: every catalog function is renderer-only, so such calls are refused.

With `sendDataModel`, an `<a2ui-data-model>` block follows: `{"version":"v1.0","surfaces":{"onboarding-2c1d":{...}}}`.
Treat all of it like anything else the user typed.
The user may also ignore the form and answer in plain text; accept that.
When the user asks for plain text instead (the chat's "Ask me in text instead" button sends "The form didn't work.
Ask me in plain text instead."), answer that question in plain text and send no block for it.

## Rules

- One block per reply, at the end.
  Keep forms short.
- Only where the conversation carries renderer capabilities (see above).
- Never ask for secrets.
  Credentials are set by the user in the platform's connections, not typed into chat.

## Check before you send

When your tools include `check_chat_form` (on the platform MCP server), call it with your whole reply before you send it, with `"attempt": 1`.
It answers `ok`, or the problems the chat would report.
Fix every problem and call it again with the next attempt number.
If attempt 3 still fails, send no block: ask the same questions in plain text, as a numbered list with the options and your recommendation.
The tool refuses a fourth attempt.

## Lock the chat input

Add this to `createSurface` to disable the chat's text input until the user answers through the form:

```
"metadata": {"extensions": {"urn:platform:a2ui:extension:chat:v1": {"lockComposer": true}}}
```

- Lock only when the form covers every answer the user may want to give: a confirmation, a short closed question, or a choice with an "Other" option and a text field.
- Do not lock a long form, a question the user may want to discuss, or a card that only shows a result.
- The form needs a `Button` with an `event` action in the tree under `root`; without one the chat reports an error.
- The lock ends when the user sends the form or a newer reply arrives, and the chat never locks a form that has an error.

## Recommend where you can

When the context gives you a reason to prefer an answer, recommend it.
Don't make the user work out what you already know.

- Preselect it: put the recommended value in `dataModel`, so the form opens with it chosen.
- Mark it: list it first and end its label with ` (Recommended)`.
  A `Switch` says it in its `description` instead ("Recommended: on").
- Say why in one short caption under the input: what in the kit, the repository or an earlier answer makes it the better pick.
- In a single choice, recommend one option.
  In a multiple choice, preselect and mark every option you recommend.
- Make the button for the recommended path `primary`, and the alternatives `default` or `borderless`.
- Don't recommend when you have no reason, when the answer is a matter of taste or a value only the user knows (a name, a channel, a repository), or when the choice has a cost or risk they must weigh (spending, deleting, granting access).
  Leave those empty and guard them with a `required` check.

## Example: kit update

<a2ui-json>
[
  {"version": "v1.0", "createSurface": {
    "surfaceId": "kit-update-7f3a",
    "catalogId": "urn:platform:a2ui:catalog:chat:v1",
    "components": [
      {"id": "root", "component": "Card", "child": "body"},
      {"id": "body", "component": "Column", "children": ["title", "summary", "changes", "why", "diff", "actions"]},
      {"id": "title", "component": "Text", "text": "## Kit update"},
      {"id": "summary", "component": "Text", "variant": "caption", "text": {"@call": "formatString", "args": {"value": "${/count} changes since ${/from}"}}},
      {"id": "changes", "component": "ChoicePicker", "label": "Changes to take", "variant": "multipleSelection", "value": {"@path": "/take"}, "options": [
        {"label": "Weekly self-audit schedule (Recommended)", "value": "schedule-audit"},
        {"label": "Skill triage v2 (Recommended)", "value": "skill-triage"},
        {"label": "Stricter egress preset", "value": "egress"}
      ]},
      {"id": "why", "component": "Text", "variant": "caption", "text": "Recommended: both run on what this agent already has. The egress preset blocks two hosts your schedules call, so that one is your call."},
      {"id": "diff", "component": "Diff", "title": "ONBOARDING.md", "diff": "@@ -1,2 +1,2 @@\n-Ask for the team channel.\n+Ask for the team channel and the on-call rota."},
      {"id": "actions", "component": "Row", "justify": "end", "children": ["skip", "apply"]},
      {"id": "skip", "component": "Button", "variant": "borderless", "child": "skip_label", "action": {"event": {"name": "skip_update", "userMessage": "Skipped this update"}}},
      {"id": "skip_label", "component": "Text", "text": "Skip all"},
      {"id": "apply", "component": "Button", "variant": "primary", "child": "apply_label",
        "checks": [{"condition": {"@call": "required", "args": {"value": {"@path": "/take"}}}, "message": "Pick at least one change"}],
        "action": {"event": {"name": "apply_update", "userMessage": "Apply the selected changes", "context": {"take": {"@path": "/take"}}}}},
      {"id": "apply_label", "component": "Text", "text": "Apply selected"}
    ],
    "dataModel": {"count": 3, "from": "v1.4.0", "take": ["schedule-audit", "skill-triage"]}
  }}
]
</a2ui-json>

After applying, update the same card in your next reply:

<a2ui-json>
[
  {"version": "v1.0", "updateComponents": {"surfaceId": "kit-update-7f3a", "components": [
    {"id": "body", "component": "Column", "children": ["title", "done"]},
    {"id": "done", "component": "Callout", "tone": "success", "text": "Applied 2 changes. The new schedule starts on Monday."}
  ]}}
]
</a2ui-json>

## Example: onboarding answers

<a2ui-json>
[
  {"version": "v1.0", "createSurface": {
    "surfaceId": "onboarding-2c1d",
    "catalogId": "urn:platform:a2ui:catalog:chat:v1",
    "components": [
      {"id": "root", "component": "Column", "children": ["intro", "team", "email", "cadence", "first_run", "budget", "actions"]},
      {"id": "intro", "component": "Callout", "tone": "info", "text": "A few things only you can tell me."},
      {"id": "team", "component": "TextField", "label": "Team name", "value": {"@path": "/team"},
        "checks": [{"condition": {"@call": "required", "args": {"value": {"@path": "/team"}}}, "message": "Enter the team name"}]},
      {"id": "email", "component": "TextField", "label": "Contact email", "placeholder": "name@example.com", "value": {"@path": "/email"},
        "checks": [{"condition": {"@call": "email", "args": {"value": {"@path": "/email"}}}}]},
      {"id": "cadence", "component": "ChoicePicker", "label": "Report cadence", "displayStyle": "chips", "value": {"@path": "/cadence"}, "options": [
        {"label": "Daily", "value": "daily"},
        {"label": "Weekly", "value": "weekly"}
      ]},
      {"id": "first_run", "component": "DateTimeInput", "label": "First report", "enableDate": true, "enableTime": true, "value": {"@path": "/firstRun"}},
      {"id": "budget", "component": "Slider", "label": "Monthly budget (USD)", "min": 0, "max": 200, "steps": 20, "value": {"@path": "/budget"}},
      {"id": "actions", "component": "Row", "justify": "end", "children": ["save"]},
      {"id": "save", "component": "Button", "variant": "primary", "child": "save_label",
        "checks": [{"condition": {"@call": "and", "args": {"values": [
          {"@call": "required", "args": {"value": {"@path": "/team"}}},
          {"@call": "email", "args": {"value": {"@path": "/email"}}}
        ]}}, "message": "Fill in the team and a valid email"}],
        "action": {"event": {"name": "save_onboarding", "userMessage": "Saved the onboarding answers", "context": {
          "team": {"@path": "/team"}, "email": {"@path": "/email"}, "cadence": {"@path": "/cadence"},
          "firstRun": {"@path": "/firstRun"}, "budget": {"@path": "/budget"}}}}},
      {"id": "save_label", "component": "Text", "text": "Save"}
    ],
    "dataModel": {"cadence": ["weekly"], "budget": 50, "firstRun": ""}
  }}
]
</a2ui-json>

## Example: a list from data

<a2ui-json>
[
  {"version": "v1.0", "createSurface": {
    "surfaceId": "connections-91be",
    "catalogId": "urn:platform:a2ui:catalog:chat:v1",
    "components": [
      {"id": "root", "component": "Card", "child": "body"},
      {"id": "body", "component": "Column", "children": ["title", "rows"]},
      {"id": "title", "component": "Text", "text": "**Connections this kit uses**"},
      {"id": "rows", "component": "List", "children": {"componentId": "row", "path": "/connections"}},
      {"id": "row", "component": "Row", "align": "center", "children": ["row_name", "row_state"]},
      {"id": "row_name", "component": "Text", "weight": 1, "text": {"@call": "formatString", "args": {"value": "${@index(offset: 1)}. ${name}"}}},
      {"id": "row_state", "component": "Badge", "text": {"@path": "state"}, "tone": "neutral"}
    ],
    "dataModel": {"connections": [
      {"name": "Slack", "state": "connected"},
      {"name": "GitHub", "state": "not connected"}
    ]}
  }}
]
</a2ui-json>
