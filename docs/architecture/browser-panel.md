# Browser panel

Last verified: 2026-10-06

## Overview

The **Browser Panel** lets a user see and use a web app their agent runs — a dev server, a quick HTTP server, a whole nested platform — from a panel beside the chat, without SSH port-forwarding. It is experimental: it shows only to a user with the addressed-credential-injection flag ([features](features.md)), and only on an agent that requires named connections ([connections](connections.md#addressing-a-connection)).

The app never runs in the user's browser. A Chromium **inside the agent's sandbox** loads it, and the panel shows that browser's viewport as a stream of frames and sends the user's mouse and keys back. The user's browser only ever draws pixels and runs the platform's own code.

## Why a remote browser

Whatever an agent serves is untrusted: the agent runs arbitrary code and can be steered by anything it reads. Served into the user's browser, that code would need an origin of its own — on the app's origin it could act as the user against the API — and a separate origin per agent and port, or one agent's app could read another's storage. That takes wildcard DNS and certificates the platform's installs do not have, plus routing for each new host. Rendering in the sandbox needs none of it, and the terminal relay already carries trusted-code-rendered bytes the same way.

It also removes the framing problems: nothing is framed, so an app that forbids framing (the platform's own UI) renders, and an app's sign-in redirects stay inside the sandbox, where its own identity provider is reachable on loopback.

The cost is fidelity: screen updates are compressed images, and each input takes one round trip before its effect shows.

## The stream

The shared browser runs headed, in kiosk mode and with no bar of its own, on a virtual X display in the sandbox — Xvfb, with i3 keeping the one window full-screen — the image's full Chromium, launched by `platform-browser` for the panel and the agent alike. The browser fills the screen and the screen is sized to the panel, so the page lays out at the panel's size with no emulated viewport; `platform-browser` refuses the agent's `set viewport` for that reason.

The panel shows that display through **[Selkies](https://github.com/selkies-project/selkies)**, a stream server for Linux displays: it captures the X screen, encodes it as H.264 and sends it over a WebSocket to its web client, which decodes it with WebCodecs and sends the user's pointer and keys back as X input. The web client is built into the api-server image from a pinned commit and served at `/api/public/browser-stream/<agent>/`; the panel frames it from the same origin. Only its socket, `.../api/websockets`, reaches the agent: through the browser relay, with the usual admission, to agent-runtime, which relays it to Selkies on the sandbox's loopback. No code from the sandbox runs on the platform's origin. The client asks Selkies for the panel's size, and Selkies resizes the display to it. Sound travels on the same socket: Chromium plays into PipeWire (with its PulseAudio server, so Chromium and Selkies need nothing else), Selkies captures it as Opus and stops sending while it is silent, and pages may play without a click, since the user's click lands in the panel, not in the sandbox.

Every piece is permissively or weakly licensed — Selkies and its pixelflux encoder MPL-2.0, Xvfb MIT, i3 BSD, PipeWire MIT with LGPL parts (its GPL JACK library is not installed) — and none is GPL. pixelflux's published wheels link x264 and x265 (GPL), so the image builds it from source without them (`packages/agents/base/selkies`): Cisco's OpenH264 encodes H.264, kvazaar H.265, and the build fails if anything links x264, x265 or FFmpeg.

- **Coordinates.** The screen follows the size of the panel in the focused tab, at a pixel ratio of 1. The agent's screenshots are in CSS pixels, so a screenshot pixel is the CSS pixel its mouse commands take, whatever the user's screen.
- **What the runtime records.** Step timings, launches and restarts go to a log file in the agent's home, so a misbehaving panel can be read after the fact.

## One browser, kept running

Every panel of an agent, and the agent itself, use the same browser, so its lifecycle has one owner on each side.

- **`platform-browser` launches it.** Whoever calls first — a panel or the agent — the launch runs under a lock held with `flock`, which the kernel releases when its holder dies, so two callers never start two Chromes on the one profile. Before launching, it stops any Chromium left on the profile and deletes the profile's lock files: a lock from the previous boot names a process id the new boot may reuse, and Chrome then exits without starting. It sets agent-browser's whole configuration itself rather than inheriting the caller's environment, since agent-browser refuses a daemon started with a different one; a daemon that still has one is replaced.
- **agent-runtime supervises it for the panels.** One supervisor serves every panel: it runs its browser commands one at a time, and keeps the browser running for them. When the browser fails to start, dies, or answers nothing for a minute, the supervisor launches it again, retrying with a growing delay; the panels stay connected and show the browser starting, or the failure with a Restart button, instead of reconnecting. A size that fails to apply is logged and set again by the next health check. Navigation runs inside the page rather than with `open`, which holds agent-browser's command queue until the page has loaded.

## The path

```mermaid
sequenceDiagram
  participant UI as ui (browser panel)
  participant API as api-server (browser relay)
  participant RT as agent-runtime
  participant AB as agent-browser (preview session)
  UI->>API: WebSocket /api/agents/:id/browser (token)
  API->>API: admission (token, owner, scope, terms) + agent requires named connections
  API->>RT: WebSocket /api/browser (address, frame rate)
  RT->>AB: launch the session (persistent profile), read its stream port
  RT->>AB: WebSocket to the stream server
  AB-->>UI: address updates
  UI->>RT: stream client's WebSocket (through the relay), relayed to Selkies
  UI->>AB: mouse, keyboard, wheel input
  UI->>RT: navigate / reload / clear browser data
```

- **The relay** is one more agent relay beside chat, terminal and SSH, with the same admission ([cli](cli.md)) and one more gate: an agent whose gateway injects credentials into unnamed requests is refused. The user may open any web address — a loopback dev server, or an external page to sign in — so with ambient injection the user would be browsing as the agent's accounts. With named connections only, unaddressed browser traffic carries no credential of the agent's.
- **agent-runtime** drives the image's agent-browser tool rather than Chromium directly: agent-browser already streams a session's viewport and accepts input over a local WebSocket. agent-runtime pipes that stream and handles the panel's own control messages — navigate, reload, clear browser data — as agent-browser commands. Only http and https addresses open. The panel sends its size, and the browser's viewport follows it, so the page lays out at the size the user sees. A reconnect without an address reattaches without reloading the page.
- **There is one browser, and the agent uses it too.** The panel shows agent-browser's `preview` session, and so does every agent-browser command in the sandbox: the image puts an `agent-browser` ahead of the real one on the PATH that hands each command to `platform-browser`, dropping any `--session` or `--profile`. The user always sees what the agent does in a browser and shares its sign-ins, and the sandbox never runs a second Chromium beside the panel's.

## The agent opens a page

An agent shows the user a page with one command its image ships, `platform-browser open <address>`, taught by a `platform-browser` skill. It points the shared session at the address — an open panel shows it at once — and prints a link in the `platform://browser` scheme for the agent to paste into its reply. Any other subcommand is an agent-browser command on that session, so the agent acts in the user's browser while the user watches; closing it is refused, since the panel is attached to it. The chat renders that link as a button, as it renders an artifact link; clicking it opens the panel and navigates there. The link carries when the command ran; a link from the last two minutes — in the agent's reply or in the command's own output — opens the panel there by itself, once, so the user need not click, while a conversation opened later opens nothing. The button is inert where the panel is not offered. Nothing about the link is trusted: it carries only an address, which must be http or https, and the click is the user's.

## Sign-ins and lifetime

The `preview` session keeps a browser profile in the agent's home, so sign-ins survive hibernation and a closed panel. The agent can use them — the panel says so once — and "Clear browser data" closes the browser and deletes the profile. "Restart browser" stops the browser — its daemon and the Chromium on the panel's profile, nothing else — and the supervisor launches a fresh one on the same profile while the panels stay connected. Every browser command has a short deadline and runs in its own process group, killed whole when the deadline passes, so a stuck page cannot pile commands up.

An open panel keeps the agent awake the way an open chat does: it counts towards the agent's open connections, not towards runtime work. Only the user's input stamps last activity; frames never do, so a forgotten panel does not refresh the idle clock by itself.

agent-runtime closes the browser ten minutes after the last viewer leaves. It does not know whether the agent is still using the session in that window — agent-browser reports no last-use time — so an agent mid-way through its own browser work can lose the window; its next agent-browser command launches the session again, with the same profile, since the agent instructions name both. A running Chromium never keeps the agent awake on its own.

## Limits

- A page can still name one of the agent's connections on purpose — through its path prefix or token placeholder — and have its credential injected, as the agent's own code can. That needs the connection's id and is accepted, not guarded.
- Only images that ship agent-browser and its Chromium can serve the panel.
- Opening in a new tab, clipboard, file transfer and sharing beyond the owner are not built.
