# Running a satellite as a service — operations

Last verified: 2026-11-02

How to keep a `dam satellite` worker running on a machine nobody watches, so an Agent can reach it whenever it needs to.
The commands below are the whole procedure; what a worker does when the network drops is on [satellites.md](../architecture/satellites.md#staying-connected).

## Credentials first

A service has no browser, so it cannot sign in.
Mint a serve key where you are signed in, and give it to the worker in `DAM_TOKEN`:

```sh
dam auth token create --name satellite-build-farm --scope satellites:serve
```

The plaintext is printed once, on stderr.
A key has no expiry unless `--expires` names one, which is what lets a machine outside the cluster keep serving without a person: an interactive `dam login` would eventually expire instead.

Put the key in a file only its owner can read, and never in the unit itself:

```sh
mkdir -p ~/.config/dam
install -m 600 /dev/null ~/.config/dam/satellite.env
printf 'DAM_TOKEN=%s\n' 'the-token-from-above' > ~/.config/dam/satellite.env
```

## systemd (Linux)

`~/.config/systemd/user/dam-satellite.service`:

```ini
[Unit]
Description=Satellite worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.config/dam/satellite.env
ExecStart=%h/.local/bin/dam satellite mcp --name build-farm -- npx -y @acme/build-mcp
Restart=always
RestartSec=5
# A long job is not waited for: the worker drains, and what is still running
# when this expires is killed, with the Job settled as interrupted.
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

`systemd-analyze --user verify ~/.config/systemd/user/dam-satellite.service` parses it and reports what it cannot.

```sh
systemctl --user daemon-reload
systemctl --user enable --now dam-satellite
loginctl enable-linger "$USER"   # keeps it running with nobody logged in
```

`ExecStart` is the worker command line you would type yourself — `dam satellite mcp …` or `dam satellite shell …` — with an absolute path to `dam` from `command -v dam`, since a user unit does not read your shell's `PATH`.
The MCP server a worker starts inherits the worker's environment, so `Environment=` and `EnvironmentFile=` reach it too.

Read its log with `journalctl --user -u dam-satellite -f`.
`systemctl --user stop dam-satellite` sends `SIGTERM`, which drains.

## launchd (macOS)

`~/Library/LaunchAgents/dev.dam.satellite.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.dam.satellite</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/dam</string>
    <string>satellite</string>
    <string>mcp</string>
    <string>--name</string>
    <string>build-farm</string>
    <string>--</string>
    <string>npx</string>
    <string>-y</string>
    <string>@acme/build-mcp</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/dam-satellite.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/dam-satellite.log</string>
</dict>
</plist>
```

```sh
launchctl load -w ~/Library/LaunchAgents/dev.dam.satellite.plist
```

`plutil -lint` on the file catches a typo before launchd does.
launchd reads no shell profile and expands no `~` inside these strings, so `PATH` is written out here and every path is literal.
The token goes in `EnvironmentVariables` as `DAM_TOKEN`; `chmod 600` the file, since that is where the key is written.

Read its log with `tail -f /tmp/dam-satellite.log`, and stop it with `launchctl unload ~/Library/LaunchAgents/dev.dam.satellite.plist`, which sends `SIGTERM`.

## Changing or removing what it serves

There is no reload: edit `ExecStart`, or the Command Surface the worker was started with, and restart the unit.
Stop the unit **before** removing the Satellite on the Connections page.
A Satellite that was removed makes the worker stop claiming and exit, and a unit with `Restart=always` starts it again, which registers it anew.

## What the log says

One line per state change, and one per call:

- `connected as "build-farm" — tools:` and the tools it offers, once, at the first successful registration.
- `reconnected as "build-farm"` after the platform was unreachable.
- `offline: … — retrying in 4.0s` for each attempt, from a second up to half a minute.
- `not signed in (…) — run dam login, or set DAM_TOKEN …` when the key is missing, revoked or expired.
  Replace the value in `satellite.env` and restart the unit: the worker reads its environment once, when it starts.
- `restarted what this machine serves — the MCP server had exited` when the server the worker started died and was started again.
- `DONE #7 in 1.2s: exit 0`, `FAILED`, `BLOCKED`, `CANCELLED`, `INTERRUPTED` for each call, as [satellites.md](../architecture/satellites.md#surfaces) describes.
