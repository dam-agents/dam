# Browser panel

Last verified: 2026-10-15

## Overview

The **Browser Panel** lets a user see and use a web app their agent runs — a dev server, a quick HTTP server, a whole nested platform — from a panel beside the chat, without SSH port-forwarding.
It shows only on an agent that requires named connections, which a new agent does by default ([connections](connections.md#addressing-a-connection)).

The app never runs in the user's browser.
A Chromium **inside the agent's sandbox** loads it, and the panel shows that browser's screen as a video stream and sends the user's pointer and keys back.
The user's browser only ever draws pixels and runs the platform's own code.

## Why a remote browser

Whatever an agent serves is untrusted: the agent runs arbitrary code and can be steered by anything it reads.
Served into the user's browser, that code would need an origin of its own — on the app's origin it could act as the user against the API — and a separate origin per agent and port, or one agent's app could read another's storage.
That takes wildcard DNS and certificates the platform's installs do not have, plus routing for each new host.
Rendering in the sandbox needs none of it.

It also removes the framing problems: the app is never framed, so an app that forbids framing (the platform's own UI) renders, and an app's sign-in redirects stay inside the sandbox, where its own identity provider is reachable on loopback.

The cost is fidelity: the screen arrives as compressed video, and each input takes one round trip before its effect shows.

## One browser

The panel shows **the browser agent-browser drives**.
The image sets agent-browser's defaults through its `AGENT_BROWSER_*` variables: Playwright's full Chromium, headed on the sandbox's virtual display, in kiosk mode, with sound, on a profile in the agent's home.
So every plain `agent-browser` command — the agent's, and the runtime's for the panel — runs on that one browser: the user watches what the agent does and shares its sign-ins, and the agent sees what the user does.
A command-line flag still overrides its variable, so an agent that passes `--session` or `--profile` gets a browser of its own that the panel does not show; the agent instructions and the `agent-browser` skill say not to.

**Testing mode.** Chromium reports itself automated (`navigator.webdriver`) whenever its DevTools port is open, and agent-browser drives it through that port, so by default every page sees an automated browser; some sites' bot checks then refuse the user's own clicks.
The panel's menu has a "Browser testing mode" switch, on by default.
With it off, Chromium is launched with that report turned off (`--disable-blink-features=AutomationControlled`), a launch switch, not a script in the page, and the DevTools port stays: the agent and the panel control the browser as before.
It changes only that report: a site may still tell the browser apart by other signs, and turning testing mode off does not promise that its check passes.
The choice is a file in the agent's home, `~/.local/share/platform/browser-launch`, beside the profile, so it survives a restarted browser, a restarted agent and "Clear browser data".
agent-browser launches Chromium through the image's launcher, `platform-browser` (its `AGENT_BROWSER_EXECUTABLE_PATH`), which reads that file on every launch, so a browser the agent's own command starts is launched the same way as the panel's, and opening the panel, a new turn or the agent's command never sets it back.
Switching saves the choice and restarts the browser at once, on the same profile, and opens the page it showed again; the panels show it starting meanwhile.
A runtime too old to report the mode shows the switch disabled.

**Quiet in the background.** The browser is Chrome for Testing, which calls Google's services on its own: network time, account and sync checks, push-messaging check-in, search suggestions.
Every such call is egress the gateway holds for the user's approval, though no page asked for it.
A managed policy in the image (`/etc/opt/chrome_for_testing/policies/managed/platform.json`) turns off network time, sign-in, sync, search suggestions and Google's AI and search side panel features, and makes DuckDuckGo the default search engine, as the panel's address bar already is — so the new tab page is Chromium's own, not Google's, which fetches from `www.google.com`.
Launch switches point the account check and the push-messaging check-in at a closed loopback port.
Safe Browsing and the component updater stay on: the updater is how Chrome gets security-critical data such as certificate revocations, and it is the only background traffic left.

## Tabs

The one browser has tabs, and the panel shows them all in a tab bar under its toolbar: each tab's title, whether it is loading, and which one is on screen.
The user opens, selects and closes tabs there, and a tab opened, selected, renamed or closed by the agent or by a page — a link that opens a new tab, a popup — shows in the bar as Chromium reports it.
The kiosk window shows only one tab, so **the tab on screen is the active tab**: the panel's address, title, loading and Back and Forward are always that tab's.

Every tab is known by its **target id**, Chromium's own id for it, which agent-browser accepts as a tab reference too; positions in the list are never used.
The toolbar names the tab the panel shows, so a tab the agent brings to the front meanwhile does not redirect the user's reload or address, and an action on a tab that has closed — also between the panel's list and Chromium's answer — is refused as a closed tab rather than run on another one.

The user and the agent share the active tab both ways.
A tab the agent brings to the front — `agent-browser tab`, `tab new`, a page's popup — comes on screen, and Chromium sends no event for that, so the runtime asks each tab whether it is visible once a second while a panel watches; a tab that has just turned visible becomes the active tab.
A tab the user selects comes to the front at once, and the runtime then selects it in agent-browser too (`agent-browser tab <target id>`, in agent-browser's queue), so the agent's next command acts on the page the user sees.
agent-browser does not list the browser's own pages, such as the new tab page a keyboard shortcut opens; the panel shows them and brings them to the front, but the agent stays on its last tab.
What the agent only reads — a snapshot, a screenshot, a script — changes neither.

A new tab from the panel is blank (`about:blank`), so agent-browser takes it as its own tab; the address bar is focused for it.
Closing the active tab brings the tab after it in the bar to the front, else the one before.
Closing the last tab opens a blank one first, as the browser would otherwise close its only window and exit.
The tab list is the browser's, never the panel's: a panel that reconnects or opens again is sent the tabs and the active tab as they are.
A runtime too old to report tabs shows the panel without its tab bar.

## The display

`platform-display` is the display stack: Xvfb (the virtual display), i3 keeping every window full-screen, PipeWire with its PulseAudio server for sound, and **[Selkies](https://github.com/selkies-project/selkies)**, a stream server for Linux displays.
agent-runtime does not start it before it answers its health check, where it would take the CPU a small machine needs to come up: it starts it on first use — a prompt to any harness, or a terminal or SSH session starting, which is how the agent's own `agent-browser` finds a display, or the panel asking for its browser or its stream — or ten seconds after it starts answering its health check, whichever comes first, and keeps it running from then on.
It does not start with a harness: the default harness starts as soon as the health check answers ([sessions](sessions.md#session-inside-the-pod)), and Selkies' few seconds of start-up CPU made the first session open about 0.15 s later.
A prompt is early enough for a tool call: the virtual display is up about 0.1 s after the start, before the model's first answer.
That delay is the limit: a command run by anything else in those ten seconds finds no display yet.
It exits as soon as any part of it dies, and agent-runtime kills what it left and starts it again, with a growing delay while it keeps failing, so a crashed stream server or display comes back by itself.

Selkies captures the screen, encodes it as VP8 and sends it over a WebSocket to its web client, which decodes it with WebCodecs and sends pointer and keys back as X input.
The client asks for the panel's size and Selkies resizes the display to it, at a pixel ratio of 1: the browser fills the screen, so the page lays out at the panel's size, and the agent's screenshot pixels are the CSS pixels its mouse commands take.
Sound travels on the same socket: Chromium plays into PipeWire, Selkies captures it as Opus, and pages may play without a click, since the user's click lands in the panel, not in the sandbox.

The web client is Selkies' own, taken from the same released wheel as the stream server — the version and hash its lock pins — into the api-server image, and served at `/api/public/browser-stream/<agent>/`; the panel frames it from the same origin, with its sidebar and buttons turned off from the server.
Only its socket, `.../api/websockets`, reaches the agent: through the stream relay, with the usual admission, to agent-runtime, which relays it to Selkies on the sandbox's loopback.
Its other requests to the server (its transport mode, a mode switch) are not relayed and fail, which leaves it on WebSockets, the mode this server runs.
No code from the sandbox runs on the platform's origin.

**Licences and codecs.** The platform's own code links none of the stack: agent-runtime starts `platform-display` and talks to Selkies over a socket, and the api-server serves Selkies' web client as files.
Selkies and pixelflux are MPL-2.0, Xvfb MIT, i3 BSD and PipeWire MIT with LGPL parts.
Everything is a released package: Selkies and its Python dependencies are installed from their published wheels, each pinned by hash (`packages/agents/base/selkies`), and the rest from Debian; pixelflux's and pcmflux's wheels bundle their native libraries, x264, x265 and FFmpeg (GPL) among them, which therefore run inside Selkies' own process and nowhere else.
MPL-2.0 permits that combination.
An image distributed beyond the platform's own clusters carries the GPL's and LGPL's duty to make those components' sources available, as it does for the Debian packages it ships: `/opt/selkies/NOTICE.md` names each one and where its source is, and the stream page serves the client's MPL license and source beside it (`LICENSE`, `NOTICE`).
Some Debian dependencies are GPL too — PipeWire's FFADO and FFTW plugins, `dex` beside i3, `cpp` beside `xrandr` — and none of them is loaded or run.
Selkies streams VP8 alone, locked: it is royalty-free and the lightest of those codecs to encode on a small CPU share, and every current browser decodes it (Safari from 16.4).
H.264 and H.265 are patent-pooled, so their encoders, present in the wheel, are never offered.

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

- **Offered only on agents that require named connections.** The user may open any web address — a loopback dev server, or an external page to sign in — so with ambient injection the user would be browsing as the agent's accounts.
  With named connections only, unaddressed browser traffic carries no credential of the agent's.
  Both halves refuse any other agent: the stream relay checks the agent's spec at the api-server, and the runtime refuses the control procedures unless the controller told it the agent requires named connections (`PLATFORM_REQUIRE_CONNECTION_ADDRESS`, always set, after the agent's own secret, so the owner's environment cannot claim it).
- **The control** is the runtime's `browser` tRPC procedures, on the same agent tRPC connection the UI uses for files and sessions: `browser.watch`, a subscription that keeps the browser up while a panel watches and reports its state, and the toolbar's mutations.
  One supervisor in agent-runtime serves every panel.
  It launches the browser through agent-browser if it is not running, then opens a DevTools Protocol connection of its own to that Chromium and follows its tabs and the one on screen ([Tabs](#tabs)): their addresses, titles, whether they are loading, and whether Back and Forward can go anywhere reach the panel the moment Chromium reports them, and the toolbar's navigate, reload, stop, back and forward and the tab bar's new, select and close run on the tab they name directly, never queued behind the agent's commands in agent-browser's one-at-a-time queue.
  Words typed into the address bar that are not an address search DuckDuckGo.
  A dropped DevTools connection means the browser is gone, and the supervisor launches it again.
  A health check that times out finds the browser busy — a heavy page, or the agent keeping it busy — not gone, so it is left alone; when the browser fails to start, or answers nothing for a minute, the supervisor stops it — its daemon, the Chromium on its profile, and the profile's lock files, which would keep the next Chromium from starting — and launches it again, retrying with a growing delay.
  The panels stay connected through all of it and show the browser starting, or the failure with a Restart button.
  Only http and https addresses open.
- **The stream socket** is one more agent relay beside chat, terminal and SSH, with the same admission ([cli](cli.md)) plus the named-connections gate; it is relayed as it is to the runtime's `/api/browser/display`, which hands it to Selkies.
  A socket that arrives before Selkies answers is held, with what its client sent up to a cap, until it does.
  The token in the client's query is not passed on.

## The agent opens a page

An agent shows the user a page by opening it with agent-browser — an open panel shows it at once — and writing a link in the `platform://browser` scheme into its reply, as the `agent-browser` skill teaches (it prints one with the address and the current time).
The chat renders that link as a button, as it renders an artifact link; clicking it opens the panel and navigates there.
The link carries when it was made; a link from the last two minutes opens the panel there by itself, once, so the user need not click, while a conversation opened later opens nothing — and it waits while the docked slot holds an unsaved draft, which a click asks about first, as every opener of that slot does.
The button is inert where the panel is not offered.
Nothing about the link is trusted: it carries only an address, which must be http or https, and the click is the user's.

## Sign-ins and lifetime

The browser's profile lives in the agent's home, so sign-ins survive hibernation and a closed panel.
The agent can use them — the panel says so once — and "Clear browser data" stops the browser and deletes the profile.
"Restart browser" stops it and the supervisor launches a fresh one on the same profile while the panels stay connected.
Both keep the testing mode choice.
Every browser command has a short deadline and runs in its own process group, killed whole when the deadline passes, so a stuck page cannot pile commands up.
Launches, failures and restarts go to a log file in the agent's home, so a misbehaving panel can be read after the fact.

The browser keeps running when the last panel closes, since the agent may be using it; agent-browser never idle-closes a headed browser.
An open panel keeps the agent awake the way an open chat does: it counts towards the agent's open connections, not towards runtime work.
The panel never wakes a sleeping agent, since the stream client reconnects by itself whenever its socket closes, as it does when the user puts the agent to sleep: the stream socket only waits out a wake something deliberate asked for, such as the chat or the wake button, and counts as an open connection only once the agent's end is open.
The control rides the UI's tRPC connection to the agent, which stamps last activity while it is open, as for any open view of the agent; nothing on the stream socket does — the stream client acknowledges frames many times a second.
A hidden tab stops its stream until it is shown again.
A running Chromium never keeps the agent awake on its own.

## Limits

- A page can still name one of the agent's connections on purpose — through its path prefix or token placeholder — and have its credential injected, as the agent's own code can.
  That needs the connection's id and is accepted, not guarded.
- The sandbox renders and encodes without a GPU, so heavy pages and video play less smoothly than locally, and more so on a small CPU share.
- Opening in a new tab, file transfer and sharing beyond the owner are not built.
