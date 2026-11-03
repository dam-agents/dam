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

Put the key in a file only its owner can read, and never in a unit or a plist: a supervisor's own configuration is the first thing anyone with the machine's account reads.
The value is typed at a prompt that echoes nothing, so it never lands in the shell history.
`stty` and `read` are POSIX and work the same in bash, zsh and dash, which matters because macOS starts zsh:

```sh
mkdir -p ~/.config/dam
chmod 700 ~/.config/dam
install -m 600 /dev/null ~/.config/dam/satellite.env
printf 'paste the serve key, then press return: '
stty -echo
IFS= read -r DAM_TOKEN
stty echo
printf '\n'
[ -n "$DAM_TOKEN" ] || { echo "nothing pasted" >&2; exit 1; }
printf 'DAM_TOKEN=%s\n' "$DAM_TOKEN" > ~/.config/dam/satellite.env
unset DAM_TOKEN
```

Both unit files below read that one file: systemd with `EnvironmentFile=`, and the launchd job through a tiny wrapper, since launchd has no equivalent.

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
`TimeoutStopSec=30` is what the worker's own drain grace sits under: it stops claiming at once, lets a running job report, and stops waiting on the platform after 15 seconds, so the process is gone before systemd resorts to `SIGKILL`.
`systemctl --user stop dam-satellite` sends `SIGTERM`, which drains.

## launchd (macOS)

launchd reads no environment file, so the job runs a wrapper that reads the key file and then execs the worker.
`~/.local/bin/dam-satellite.sh`, mode 700:

```sh
#!/bin/sh
DAM_TOKEN=$(sed -n 's/^DAM_TOKEN=//p' "$HOME/.config/dam/satellite.env")
[ -n "$DAM_TOKEN" ] || { echo "no DAM_TOKEN in ~/.config/dam/satellite.env" >&2; exit 1; }
export DAM_TOKEN
exec "$HOME/.local/bin/dam" satellite mcp --name build-farm -- npx -y @acme/build-mcp
```

`~/Library/LaunchAgents/dev.dam.satellite.plist` — no token in it:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.dam.satellite</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOUR-NAME/.local/bin/dam-satellite.sh</string>
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
  <string>/Users/YOUR-NAME/Library/Logs/dam-satellite.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOUR-NAME/Library/Logs/dam-satellite.log</string>
</dict>
</plist>
```

```sh
chmod 700 ~/.local/bin/dam-satellite.sh
plutil -lint ~/Library/LaunchAgents/dev.dam.satellite.plist
launchctl load -w ~/Library/LaunchAgents/dev.dam.satellite.plist
```

launchd reads no shell profile and expands no `~` inside these strings, so every path is literal — write your home directory out where `YOUR-NAME` is, and keep `PATH` as the array above, since the worker's MCP server inherits it.
Logs go to your own `~/Library/Logs`, not to a shared `/tmp` path another account can read or fill.

Watch it with `tail -f ~/Library/Logs/dam-satellite.log`, and stop it with `launchctl unload ~/Library/LaunchAgents/dev.dam.satellite.plist`, which sends `SIGTERM`.

A macOS Keychain item, read by the same wrapper, is the alternative if you would rather not keep the key in a file; the file is what both units above share.

## Changing or removing what it serves

There is no reload: edit `ExecStart`, or the Command Surface the worker was started with, and restart the unit.

Removing the Satellite on the Connections page makes the worker stop claiming and exit at once; it does not register the name again, because that removal was the owner's decision.
A unit with `Restart=always` then starts a fresh worker, which has served nothing yet and does register the name — so if the Satellite is to stay removed, `systemctl --user disable --now dam-satellite` (or `launchctl unload`) before removing it.

## What the log says

One line per state change, and one per call:

- `connected as "build-farm" — tools:` and the tools it offers, once, at the first successful registration.
- `reconnected as "build-farm"` after the platform was unreachable.
- `offline: … — retrying in 4.0s` for each attempt, from a second up to half a minute, and `offline: cannot reach the server (…) — retrying in …` before the first one, when the platform does not answer its version probe.
- `not signed in (…) — run dam login, or set DAM_TOKEN …` when the key is missing, revoked or expired.
  Replace the value in `satellite.env` and restart the unit: the worker reads its environment once, when it starts.
- `restarted what this machine serves — the MCP server had exited` when the server the worker started died and was started again, and `the MCP server exited 0.4s after it started — retrying in …` when it keeps doing that, which is a crash loop rather than a restart.
- `could not report … yet, keeping it for the next attempt: …` when a result did not reach the platform; it is sent before more work is taken, and `dropping the outcome of …` when the name has been registered again from another machine — or when it was claimed before the platform named registrations, so it cannot be told from another machine's Job of the same number — since that result belongs to a Job nobody can settle any more.
- `draining — no longer waiting on the platform; a job still running is settled as interrupted` 15 seconds into a stop that has a job running.
- `DONE #7 in 1.2s: exit 0`, `FAILED`, `BLOCKED`, `CANCELLED`, `INTERRUPTED` for each call, as [satellites.md](../architecture/satellites.md#surfaces) describes.
