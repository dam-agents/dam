# Browser panel

Last verified: 2026-10-08

## Overview

The **Browser Panel** lets a user see and use a web app their agent runs — a dev server, a quick HTTP server, a whole nested platform — from a panel beside the chat, without SSH port-forwarding. It is experimental: it shows only to a user with the addressed-credential-injection flag ([features](features.md)), and only on an agent that requires named connections ([connections](connections.md#addressing-a-connection)).

The app never runs in the user's browser. A Chromium **inside the agent's sandbox** loads it, and the panel shows that browser's screen as a video stream and sends the user's pointer and keys back. The user's browser only ever draws pixels and runs the platform's own code.

## Why a remote browser

Whatever an agent serves is untrusted: the agent runs arbitrary code and can be steered by anything it reads. Served into the user's browser, that code would need an origin of its own — on the app's origin it could act as the user against the API — and a separate origin per agent and port, or one agent's app could read another's storage. That takes wildcard DNS and certificates the platform's installs do not have, plus routing for each new host. Rendering in the sandbox needs none of it.

It also removes the framing problems: the app is never framed, so an app that forbids framing (the platform's own UI) renders, and an app's sign-in redirects stay inside the sandbox, where its own identity provider is reachable on loopback.

The cost is fidelity: the screen arrives as compressed video, and each input takes one round trip before its effect shows.

## One browser

The panel shows **the browser agent-browser drives**. The image sets agent-browser's defaults through its `AGENT_BROWSER_*` variables: Playwright's full Chromium, headed on the sandbox's virtual display, in kiosk mode, with sound, on a profile in the agent's home. So every plain `agent-browser` command — the agent's, and the runtime's for the panel — runs on that one browser: the user watches what the agent does and shares its sign-ins, and the agent sees what the user does. A command-line flag still overrides its variable, so an agent that passes `--session` or `--profile` gets a browser of its own that the panel does not show; the agent instructions and the `agent-browser` skill say not to.

## The display

`platform-display`, run by agent-runtime for as long as it runs, is the display stack: Xvfb (the virtual display), i3 keeping every window full-screen, PipeWire with its PulseAudio server for sound, and **[Selkies](https://github.com/selkies-project/selkies)**, a stream server for Linux displays. It exits as soon as any part of it dies, and agent-runtime kills what it left and starts it again, with a growing delay while it keeps failing, so a crashed stream server or display comes back by itself.

Selkies captures the screen, encodes it as VP8 and sends it over a WebSocket to its web client, which decodes it with WebCodecs and sends pointer and keys back as X input. The client asks for the panel's size and Selkies resizes the display to it, at a pixel ratio of 1: the browser fills the screen, so the page lays out at the panel's size, and the agent's screenshot pixels are the CSS pixels its mouse commands take. Sound travels on the same socket: Chromium plays into PipeWire, Selkies captures it as Opus, and pages may play without a click, since the user's click lands in the panel, not in the sandbox.

The web client is Selkies' own, taken from the same released wheel as the stream server — the version and hash its lock pins — into the api-server image, and served at `/api/public/browser-stream/<agent>/`; the panel frames it from the same origin, with its sidebar and buttons turned off from the server. Only its socket, `.../api/websockets`, reaches the agent: through the stream relay, with the usual admission, to agent-runtime, which relays it to Selkies on the sandbox's loopback. Its other requests to the server (its transport mode, a mode switch) are not relayed and fail, which leaves it on WebSockets, the mode this server runs. No code from the sandbox runs on the platform's origin.

**Licences and codecs.** The platform's own code links none of the stack: agent-runtime starts `platform-display` and talks to Selkies over a socket, and the api-server serves Selkies' web client as files. Selkies and pixelflux are MPL-2.0, Xvfb MIT, i3 BSD and PipeWire MIT with LGPL parts. Everything is a released package: Selkies and its Python dependencies are installed from their published wheels, each pinned by hash (`packages/agents/base/selkies`), and the rest from Debian; pixelflux's and pcmflux's wheels bundle their native libraries, x264, x265 and FFmpeg (GPL) among them, which therefore run inside Selkies' own process and nowhere else. MPL-2.0 permits that combination. An image distributed beyond the platform's own clusters carries the GPL's and LGPL's duty to make those components' sources available, as it does for the Debian packages it ships: `/opt/selkies/NOTICE.md` names each one and where its source is, and the stream page serves the client's MPL license and source beside it (`LICENSE`, `NOTICE`). Some Debian dependencies are GPL too — PipeWire's FFADO and FFTW plugins, `dex` beside i3, `cpp` beside `xrandr` — and none of them is loaded or run. Selkies streams VP8 alone, locked: it is royalty-free and the lightest of those codecs to encode on a small CPU share, and every current browser decodes it (Safari from 16.4). H.264 and H.265 are patent-pooled, so their encoders, present in the wheel, are never offered.

## The path

```mermaid
sequenceDiagram
  participant UI as ui (browser panel)
  participant API as api-server
  participant RT as agent-runtime
  participant AB as agent-browser
  participant S as Selkies
  UI->>API: the agent's tRPC (/api/agents/:id/trpc-ws): browser.watch, toolbar mutations
  API->>RT: relayed to the runtime's tRPC
  RT->>RT: refuse unless the agent requires named connections
  RT->>AB: launch if not running, read its DevTools address
  RT->>RT: DevTools connection to Chromium: page events, navigation
  RT-->>UI: browser state; page address, title, loading, history
  UI->>API: stream client's WebSocket /api/public/browser-stream/:id/api/websockets
  API->>API: admission (token, owner, scope, terms) + agent requires named connections
  API->>RT: WebSocket /api/browser/display
  RT->>S: relayed to 127.0.0.1:5999
  S-->>UI: video, sound; pointer and keys back
```

- **Offered only on agents that require named connections.** The user may open any web address — a loopback dev server, or an external page to sign in — so with ambient injection the user would be browsing as the agent's accounts. With named connections only, unaddressed browser traffic carries no credential of the agent's. Both halves refuse any other agent: the stream relay checks the agent's spec at the api-server, and the runtime refuses the control procedures unless the controller told it the agent requires named connections (`PLATFORM_REQUIRE_CONNECTION_ADDRESS`, always set, after the agent's own secret, so the owner's environment cannot claim it).
- **The control** is the runtime's `browser` tRPC procedures, on the same agent tRPC connection the UI uses for files and sessions: `browser.watch`, a subscription that keeps the browser up while a panel watches and reports its state, and the toolbar's mutations. One supervisor in agent-runtime serves every panel. It launches the browser through agent-browser if it is not running — agent-browser starts it on a blank page, which the supervisor replaces with Chromium's new tab page unless an address is waiting to open, and the address bar shows that page as empty, as Chrome does — then opens a DevTools Protocol connection of its own to that Chromium and follows the tab on screen: its address, title, whether it is loading, and whether Back and Forward can go anywhere reach the panel the moment Chromium reports them, and the toolbar's navigate, reload, stop, back and forward run on that tab directly, never queued behind the agent's commands in agent-browser's one-at-a-time queue. Words typed into the address bar that are not an address search DuckDuckGo. A dropped DevTools connection means the browser is gone, and the supervisor launches it again. A health check that times out finds the browser busy — a heavy page, or the agent keeping it busy — not gone, so it is left alone; when the browser fails to start, or answers nothing for a minute, the supervisor stops it — its daemon, the Chromium on its profile, and the profile's lock files, which would keep the next Chromium from starting — and launches it again, retrying with a growing delay. The panels stay connected through all of it and show the browser starting, or the failure with a Restart button. Only http and https addresses open.
- **The stream socket** is one more agent relay beside chat, terminal and SSH, with the same admission ([cli](cli.md)) plus the named-connections gate; it is relayed as it is to the runtime's `/api/browser/display`, which hands it to Selkies. A socket that arrives before Selkies answers is held, with what its client sent up to a cap, until it does. The token in the client's query is not passed on.

## The agent opens a page

An agent shows the user a page by opening it with agent-browser — an open panel shows it at once — and writing a link in the `platform://browser` scheme into its reply, as the `agent-browser` skill teaches (it prints one with the address and the current time). The chat renders that link as a button, as it renders an artifact link; clicking it opens the panel and navigates there. The link carries when it was made; a link from the last two minutes opens the panel there by itself, once, so the user need not click, while a conversation opened later opens nothing — and it waits while the docked slot holds an unsaved draft, which a click asks about first, as every opener of that slot does. The button is inert where the panel is not offered. Nothing about the link is trusted: it carries only an address, which must be http or https, and the click is the user's.

## Sign-ins and lifetime

The browser's profile lives in the agent's home, so sign-ins survive hibernation and a closed panel. The agent can use them — the panel says so once — and "Clear browser data" stops the browser and deletes the profile. "Restart browser" stops it and the supervisor launches a fresh one on the same profile while the panels stay connected. Every browser command has a short deadline and runs in its own process group, killed whole when the deadline passes, so a stuck page cannot pile commands up. Launches, failures and restarts go to a log file in the agent's home, so a misbehaving panel can be read after the fact.

The browser keeps running when the last panel closes, since the agent may be using it; agent-browser never idle-closes a headed browser. An open panel keeps the agent awake the way an open chat does: it counts towards the agent's open connections, not towards runtime work. The control rides the UI's tRPC connection to the agent, which stamps last activity while it is open, as for any open view of the agent; nothing on the stream socket does — the stream client acknowledges frames many times a second. A hidden tab stops its stream until it is shown again. A running Chromium never keeps the agent awake on its own.

## Limits

- A page can still name one of the agent's connections on purpose — through its path prefix or token placeholder — and have its credential injected, as the agent's own code can. That needs the connection's id and is accepted, not guarded.
- The sandbox renders and encodes without a GPU, so heavy pages and video play less smoothly than locally, and more so on a small CPU share.
- Opening in a new tab, file transfer and sharing beyond the owner are not built.
