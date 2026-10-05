---
name: platform-browser
description: >
  Use whenever you start or change a web app, dev server or page the user should see or try — a local server on a port, a nested platform, a page you built — and whenever the user asks to see, open or check something in the browser. Covers the user's browser panel beside the chat, which shows a browser running in this sandbox: `platform-browser open <address>` points it at a page and prints a button for your reply, and `agent-browser --session preview` lets you see and drive the same page yourself.
---

The user's chat has a browser panel. It shows a browser that runs here, in your sandbox, so it reaches `localhost` and every port you listen on — the user needs no port forwarding. You and the user share that browser: what one of you opens, the other sees.

## Show the user a page

```
platform-browser open localhost:4444
```

- It points the shared browser at the address — the user sees it at once if their panel is open — and prints one line such as `[Open localhost:4444](platform://browser?url=…)`.
- **Paste that line, unchanged, into your reply.** The chat renders it as a button; clicking it opens the panel on that page. Without it the user may not know there is something to look at.
- An address without a scheme gets `http://`. Only http and https open.
- Start the server first, and check it answers (`curl -sI http://localhost:4444`) before you open it.
- Bind the server to `127.0.0.1` or `0.0.0.0`; the browser runs in the same sandbox, so loopback is enough.

## See what the user sees

Use the same session, with the same profile, so you neither open a second browser nor lose the user's sign-ins:

```
agent-browser --session preview --profile ~/.local/share/platform/browser-preview snapshot -i
agent-browser --session preview --profile ~/.local/share/platform/browser-preview screenshot /tmp/page.png
```

- Do not `close` this session: the user's panel is attached to it.
- For your own testing that the user need not watch, keep using your own `--session`.

## What the user's sign-ins mean

The user may sign in to services inside the panel. Those sessions live in the profile above, so you can act with them. Use them only for what the user asked for.
