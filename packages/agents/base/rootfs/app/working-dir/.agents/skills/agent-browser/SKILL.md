---
name: agent-browser
description: >
  Use for any browser task, and whenever you start or change a web app, dev server or page the user should see or try — a local server on a port, a nested platform, a page you built — or the user asks to see, open or check something in the browser. Covers `agent-browser`, which drives the one browser in this sandbox — the browser the user watches in the panel beside the chat — and the `platform://browser` button that opens the panel on a page.
---

The user's chat has a browser panel. It shows the browser that runs here, in your sandbox, so it reaches `localhost` and every port you listen on — the user needs no port forwarding. It is the browser `agent-browser` drives: what you open, the user sees, and what the user does there, you see.

## Drive the browser

```
agent-browser open localhost:4444
agent-browser snapshot -i            # the page as an accessibility tree, with @refs
agent-browser click @e3
agent-browser fill @e5 "hello"
agent-browser press Enter
agent-browser get url
agent-browser screenshot /tmp/page.png
```

- Run it without `--session` or `--profile`: either starts another browser, which the user cannot see and which cannot share this one's profile. Leave the viewport alone too (`set viewport`, `set device`): the browser fills the panel, and the panel's size is the user's.
- Take a fresh `snapshot -i` before you act: refs change whenever the page does.
- Prefer refs (`click @e3`, `drag @e3 @e7`) to coordinates. Where only coordinates work — a canvas, a game board — read them off a fresh `screenshot`: its pixels are the CSS pixels `mouse move` takes. Take it again after the user resizes the panel.
- Heavy sites load slowly here: the sandbox renders without a GPU on a small CPU share. After `open` or a click that navigates, run `agent-browser wait --load domcontentloaded` before you snapshot. A command that fails with "timed out" means the page was busy, not that the browser is gone: wait a few seconds and run it once more. If it keeps timing out, tell the user the page is too heavy for this agent's compute and suggest a higher Compute Resources tier.
- `agent-browser close` closes the user's view too; the panel starts the browser again, on the same profile.

## Show the user a page

Open it, then put a button for it in your reply:

```
url=http://localhost:4444/
agent-browser open "$url"
printf '[Open %s](platform://browser?url=%s&at=%s)\n' "${url#*://}" "$(jq -rn --arg u "$url" '$u|@uri')" "$(date +%s%3N)"
```

- **Paste the line it prints, unchanged, into your reply.** The chat renders it as a button that opens the panel on the page; a button from the last two minutes opens the panel by itself, once. Without it the user may not know there is something to look at.
- Only http and https addresses open.
- Start the server first, and check it answers (`curl -sI http://localhost:4444`) before you open it. Bind it to `127.0.0.1` or `0.0.0.0`; the browser runs in the same sandbox, so loopback is enough.

## Acting with the user watching

- Say in the chat what you are about to do, then do it.
- Ask before anything that changes state the user cares about outside your sandbox: submitting a form on an external site, buying, sending, deleting, or acting with the user's sign-ins.
- Never type a password or secret into it. If a page needs the user to sign in, open it and ask them to sign in in the panel.
- The user may sign in to services in the panel. Those sessions stay in the browser's profile, so you can act with them; use them only for what the user asked for.
