---
name: platform-artifacts
description: >
  Write HTML artifact buttons that send prompts to the open chat. Use only when
  the user explicitly requests this experimental capability and has enabled
  Interactive artifacts; ordinary artifacts do not need this skill.
---

Publish with `create_artifact({ ..., interactive: true })`. Only HTML supports
prompt buttons. The artifact remains private and cannot later become shareable;
publish a separate static copy for sharing. Omit `interactive` for ordinary pages.

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
