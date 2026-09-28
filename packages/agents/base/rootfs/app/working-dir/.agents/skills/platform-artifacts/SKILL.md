---
name: platform-artifacts
description: >
  Write interactive HTML artifacts: buttons that send prompts to the open chat,
  and pages that share state with the agent (content both the page and the
  agent read and change) through a small HTTP server the agent runs. Use
  only when the user explicitly requests this experimental capability and has
  enabled Interactive artifacts; ordinary artifacts do not need this skill.
---

Publish with `create_artifact({ ..., interactive: true })`. Only HTML supports
prompt buttons and shared state. The artifact remains private and cannot later
become shareable; publish a separate static copy for sharing. Omit `interactive`
for ordinary pages.

The platform injects `platform.sendPrompt(text)` into the page. Call it from a
button click or a form handler that prevents the default submission:

```html
<button onclick="platform.sendPrompt('Refresh this dashboard using the latest data.')">
  Refresh
</button>
```

The owner must enable Interactive artifacts and open the latest artifact version
beside an existing chat with its publishing agent. The prompt is sent as a normal
chat message, using the chat's existing queue and error handling. The agent replies
in chat and may publish a new artifact version normally. The function returns no
answer or delivery receipt; do not await a result or claim the task is complete.

Buttons do not send prompts from library previews, shared pages, historical
versions, another agent's chat, or while the feature is disabled. Keep the page
readable without this capability. Send prompts only in response to user actions,
never automatically on load or on a timer. Prompts must be nonempty strings of at
most 16,384 characters.

## Sharing state with the agent through `platform.request`

The page can call an HTTP server that you run inside your own sandbox. Use it to
give the page and you one shared, persistent state: content that the page reads
and changes, and that you read and change too, from chat, a schedule or a script.
A task list the user ticks off in the page and you work through, a draft you both
edit, notes or settings you keep between runs.

This is the difference from the page's own `localStorage`: that lives only in one
browser, and you never see it. State behind your server lives with you, usually
in files in your workspace, so both sides see the same thing.

A simple shape: keep the state in a file such as `state.json`, and serve it with
`GET /state` and `PUT /state`. You edit the file directly; the page reads it on
load and writes it back when the user changes something.

```js
const res = await platform.request({ method: "GET", path: "/state" });
const state = JSON.parse(res.body);

state.tasks[0].done = true;
await platform.request({ method: "PUT", path: "/state", body: JSON.stringify(state) });
```

The platform carries each request from the page to your server and the answer
back. The page never holds credentials, and it can only reach the agent that
published it. Your server can also do more than store state, for example run a
command or compute something on request, but keep it small.

`request({ method, path, body, contentType })` takes a method (`GET`, `POST`,
`PUT`, `PATCH` or `DELETE`), a path that starts with `/` and may include a query
string, an optional text body (not with `GET`), and an optional content type
(default `application/json` when there is a body). Bad arguments throw right
away or reject with `invalid-request`.

It resolves with `{ status, contentType, body }` for every HTTP status your server
returns, including 4xx and 5xx, like `fetch`. Check `status` yourself. It rejects
only when the platform cannot deliver the request, with an `Error` whose `reason`
is one of:

- `app-not-listening`: nothing answers on the port. Retryable.
- `timeout`: your server took longer than 30 seconds, or the platform gave no
  answer within 3 minutes.
- `response-too-large`: your response body is over 1 MiB.
- `too-many-requests`: the page already has 8 requests waiting.
- `agent-unreachable`, `unsupported-runtime`, `not-allowed`, `invalid-request`.

### Your server

- Listen on `127.0.0.1:5555` only. Never bind `0.0.0.0`. The port is fixed.
- Start it yourself so it outlives your turn, for example
  `nohup python3 server.py > /tmp/artifact-api.log 2>&1 &`. The platform never
  starts, watches or restarts it.
- It stops when the agent hibernates. When you come back to the work, check that it
  still answers (for example `curl -s 127.0.0.1:5555/...`) and start it again if
  not. A running server does not keep the agent awake.
- Keep the shared state in files in the workspace, not only in server memory, so a
  restart loses nothing and you can read and edit it without the server.
- You and the page can both change the state. When you change it, the page sees it
  on its next read, so give the page a way to reload (on focus or with a button).
  If lost updates matter, reject a write based on an old version (for example with
  a version number in the state and a `409` answer).

### Limits

Text bodies only, no binary and no streaming. At most 1 MiB each way, 30 seconds
per request, and 8 requests at once per page. Only `content-type` passes through:
the platform drops every other request and response header, so do not rely on
cookies, auth headers or custom headers.

### Where it works

The same rules as `sendPrompt`: only in the owner's docked preview beside a chat
with the publishing agent, on the latest version, with the feature enabled. It
never works on shared pages, library previews or historical versions. There, the
call rejects with `timeout` after 3 minutes. The wait is that long because waking a
hibernated agent can take up to 2 minutes. Show a loading state while you wait.

### Build the page for a missing server

- On `app-not-listening`, show a clear state such as "Server is starting" or "Ask
  the agent to start the server", with a retry button. Do not show a blank page.
- Consider putting a snapshot of the current state in the HTML when you publish,
  so the page is still useful for reading when the server is down or the page is
  opened elsewhere.
- Show errors inside the page, not only in the console.

### No browser dialogs

The frame is sandboxed without modals. `confirm()`, `alert()` and `prompt()` are
blocked silently, and `confirm()` returns `false`, so a button guarded by it does
nothing. Confirm destructive actions inline instead, for example a button that
asks "Click again to delete" on the first click.
