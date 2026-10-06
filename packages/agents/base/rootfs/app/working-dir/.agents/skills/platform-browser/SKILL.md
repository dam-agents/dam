---
name: platform-browser
description: >
  Use whenever you start or change a web app, dev server or page the user should see or try — a local server on a port, a nested platform, a page you built — and whenever the user asks to see, open or check something in the browser. Covers the user's browser panel beside the chat, which shows a browser running in this sandbox: `platform-browser open <address>` points it at a page and prints a button for your reply, and every other `platform-browser` command (`snapshot -i`, `click @e3`, `fill`) acts in that same browser while the user watches.
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

## See and act in the user's browser

Every other `platform-browser` command is an agent-browser command run on the user's browser — same page, same sign-ins — and the user watches it happen in their panel:

```
platform-browser snapshot -i            # the page as an accessibility tree, with @refs
platform-browser click @e3
platform-browser fill @e5 "hello"
platform-browser press Enter
platform-browser get url
platform-browser screenshot /tmp/page.png
```

- Take a fresh `snapshot -i` before you act: refs change whenever the page does.
- Prefer refs (`click @e3`, `drag @e3 @e7`) to coordinates. Where only coordinates work — a canvas, a game board — read them off a fresh `screenshot`: its pixels are the CSS pixels `mouse move` takes, with no scaling to correct for. Take it again after the user resizes the panel, since the viewport follows the panel's size.
- Heavy sites load slowly here: the sandbox renders without a GPU on a small CPU share. After `open` or a click that navigates, run `platform-browser wait --load domcontentloaded` before you snapshot. A command that fails with "timed out" (for example `CDP command timed out: DOM.enable`) means the page was busy, not that the browser is gone: wait a few seconds and run it once more. If it keeps timing out, tell the user the page is too heavy for this agent's compute and suggest a higher Compute Resources tier.
- Use it to show the user something or to try a flow with them watching — say in the chat what you are about to do, then do it.
- Ask before anything that changes state the user cares about outside your sandbox: submitting a form on an external site, buying, sending, deleting, or acting with the user's sign-ins.
- Never type a password or secret into it. If a page needs the user to sign in, open it and ask them to sign in in the panel.
- `platform-browser close` is refused: the panel is attached to this browser. So are `set viewport` and `set device`: the browser fills the screen, and the screen follows the size of the user's panel.
- For your own testing that the user need not watch, use plain `agent-browser` with your own `--session`; it is quicker and does not move the user's page.

## What the user's sign-ins mean

The user may sign in to services inside the panel. Those sessions live in the profile above, so you can act with them. Use them only for what the user asked for.
