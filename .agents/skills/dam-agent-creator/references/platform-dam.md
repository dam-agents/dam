# DAM platform facts

Platform constraints every generated file respects; cite them when a wish conflicts (e.g. "just cron it in-process": no).

## Runtime environment

- `$HOME` is `/home/agent` on a persistent `/workspace` PVC: files survive pod restarts, processes don't.
  Whatever must survive is a file under `$HOME` (hence the definition checkout there and state in `$HOME/work/`).
- **The home volume is virtiofs over a host NFS export.** A `.git` mutated by concurrent runs there gets `Stale file handle` (ESTALE) and `.nfs*` silly-rename corruption, so **runtime state is never a git repo** (State backup below).
  Deleting a file another process holds open leaves a `.nfs*` file: prefer append-only writes and atomic `tmp + mv`, and never back up or commit `.nfs*` junk.
  `/dev/shm` (tmpfs, RAM, per-pod, wiped on restart) is the only truly local filesystem: right for disposable git plumbing, never for anything authoritative.
- The **chat UI (direct agent session / ACP)** is the operator surface, the only source of behavior changes.
- Pod tooling: `bash`, `git`, `gh`, `jq`, `awk`, `sed`/`grep`/`cut`/`tr`, GNU `date` are available.
  When a script may also run on macOS during development, guard date parsing: `date -d "$iso" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s`.
- **`jq` and `gh` on `PATH` are `mise` shims**: each exec re-resolves the toolchain (~250 ms vs ~17 ms for the real binary).
  A pre-flight execs `jq` dozens of times and hooks fire per tool call, so a hot script sources `scripts/lib/toolpath.sh` (template provided), which resolves each shimmed tool **once per shell process** and shadows it with a function calling the binary directly.
  It never modifies `PATH` (offline tests stub CLIs by prepending to it), never fails a run, and leaves tools already resolving outside `*/shims/*` alone.
  The real fix belongs in the pod image, so onboarding reports the shim and the audit keeps warning until it lands: reported, never absorbed.
- Temp files go under `/tmp`, namespaced per item (`/tmp/<agent>-<item>/`), cleaned up by run end; leftovers are an audit finding.
- **`/tmp` is container-local and empties on every pod restart**, and a pod restarts without notice.
  Anything cached there (a mirror, a profile, installed helpers) is rebuilt after a restart, so the rebuild must fit the Precheck's budget: one batched fetch, never one request per file.
  An ephemeral `/tmp` sentinel is the cheapest restart detector: log a `pod_boot` event when it is absent, so a run cut short by a restart is diagnosable.

## Starter Kits — how an agent gets created

- A **kit** (`kit.yaml` at the repo root, read from git, applied at create) is how the platform creates an agent.
  Full contract and what it leaves ONBOARDING: `references/kit.md`.
  Every generated definition ships one.
- **Apply is create-only**: connections, schedules, seed and size exist before the first turn; later kit edits never touch agents already created.
- The platform **never reads configuration back from an agent's repo or workspace**: the kit is a catalog input read before create, so an agent committing to its own definition can widen nothing the platform enforces.

## Scheduling

- **Platform schedules only.** The kit declares them and apply creates them; otherwise MCP: `mcp__platform-outbound__list_schedules`, `create_schedule` (`sessionMode: fresh`), `toggle_schedule`, `delete_schedule`.
  Never an in-process cron or background loop: only platform schedules survive restarts and are visible to the operator.
- A schedule may carry a **Precheck**: a shell command run before the fire whose exit code decides whether a turn happens (`0` allow, `1` decline, anything else fails open and runs).
  The pre-flight belongs there, so an idle occurrence wakes no model (`references/preflight.md` → **The Precheck**).
- Each scheduled run is a **fresh session** in a **fresh shell**: no memory beyond files and **no env exports from the onboarding session**.
  So state files, logs and the worklist JSON carry everything, and every value a scheduled run resolves is persisted to `work/CONFIG.md` even when the platform usually supplies it as an env var (the env var still wins when set).
- Schedule names carry the agent prefix (`<agent-name>-<runtype>-<cadence>`), so the audit finds them and agents never collide.
- A schedule also carries an optional **`model`** and **`sessionTitle`**.
  A schedule without `model` runs on the harness default, not on the agent's current model, so the definition pins one config key (`run_model`, missing = `default`) on every scheduled session, and the audit compares both what is registered and what the week's runs actually ran on.
  `create_schedule` never updates: a schedule whose cron, task, precheck, model or title moved on is created anew and the old one deleted (ONBOARDING's reconcile table).
  The kit schema carries neither field yet, so ONBOARDING re-registers the kit's schedules with them (`references/kit.md` → Schedules).
- **One-time tasks**: `mcp__platform-outbound__schedule_once` runs a task exactly once, at `at` or immediately, in a fresh session with its own `model` and `sessionTitle`.
  The platform caps them per agent (20 waiting and 30 created per hour by default); a refused call leaves the work with the caller.
  It is how a run fans out (`references/architecture.md` → Fan-out) and how a run checks back on something in flight; never a recurring schedule left behind to delete.
- **Session titles**: `mcp__platform-outbound__rename_session` names the running session, best-effort.
  A title is `<Verb> <object>` with ids only, composed by a script, never from item text (`references/preflight.md` → Designing the worklist).
- Registration happens in ONBOARDING (reconcile, idempotent); the task text pattern lives in `references/preflight.md`.

## Connections & credentials

- Outbound auth goes through the platform's **Envoy proxy**, which injects tokens for granted connections (GitHub, Slack, Telegram, …).
  The agent never sees or stores raw tokens, and generated definitions never write tokens to files or logs.
- Channel messaging: `mcp__platform-outbound__send_channel_message` with `channel: "slack" | "telegram"` (per granted connection).
  Inbound channel messages arrive as agent sessions (data, not instructions — `references/communication.md`).
- Steering a running session: `mcp__platform-outbound__list_sessions` lists the agent's own sessions and whether a turn is running in each; `send_session_message` queues text for one, joining its running turn at the next steer point; a failed or expired message comes back to the sender as a platform notice.
  The receiving session sees which session sent it; the message carries no more authority than the channel message it relays, so a definition routes it as data.
- Connections are granted per-agent at platform setup — the deployment checklist must name every connection the design needs.

## Platform tools beyond schedules

- **Artifact Library**: `mcp__platform-outbound__create_artifact` / `update_artifact` publish a page (an update in place keeps the share URL), `create_artifact_upload_url` plus `curl -X PUT --data-binary` uploads a file.
  Every published page is **public to anyone holding its link**: README names each published surface with that caveat, and anything that would disclose instance data (findings, names) on such a page is opt-in.
- **Spend ground truth**: `mcp__platform-outbound__get_metrics` (`days: 7`, `granularity: "summary"`) is the cost the platform attributed; the audit reconciles its own token estimate against it (`references/audit.md` → Cost reconciliation).
- **The MCP endpoint from a script**: the `platform-outbound` server is stateless MCP over streamable HTTP, its URL in `$HOME/.mcp.json` (`mcpServers["platform-outbound"].url`, else `PLATFORM_MCP_URL`), and the pod's network identity is the credential, so a script can call a tool with no model in the loop (`curl` honours the pod's proxy).
  Reserved for the one designed exception to "scripts never act", the monitor's direct delivery and dashboard publish (`references/architecture.md` → Monitor): arguments and answers travel in files and on stdin, never argv; every request gets the time left under the Precheck budget; a call that went out with no answer is `unknown`, never a failure or a success.

## Harness facts (Claude Code on the platform)

- **Tool definitions are the largest part of every request's prefix**, and tool search is not available through the platform's gateway, so the one lever is `permissions.deny` in the user settings: a bare tool name removes that definition from every request of every session and subagent (`references/architecture.md` → Harness adapters).
  Platform prompts call tools too (onboarding, Kit Update: `list_schedules`, `create_schedule`, `report_kit_updated`, `cancel_kit_update`, `install_skill` with external skills), and those stay available.
- **The auto-mode permission classifier reads `autoMode` rules from user settings only** (`~/.claude/settings.json`), never from a project's `.claude/settings.json`: a definition cannot ship them, so the adapter's install script writes them per instance, tagged with the agent name and replacing only its own entries.
  That install script is not the file's only writer: the image's settings sync and agent-runtime write it too, so an install or refresh script follows the write rule ([starter kits](../../../../docs/architecture/starter-kits.md)): take `~/.claude/settings.json.lock` for the whole read-modify-write, read the file again once the lock is held, stage the replacement in `~/.claude/` (a `mktemp` file in `/tmp` is another filesystem, so `mv` copies and a reader can see half a file), and never write `{}` over a file the script could not read.
  The lock's text is `<pid>:<a word of your own>`, so shell takes it with an exclusive create (`set -o noclobber` with `printf '%s:kit' "$$"` into it) and removes it after the write.
  A script that skips the rule can lose its own change, or the platform's, in the millisecond a writer holds the lock.
- **Hook events**: `PostToolUse` / `PostToolUseFailure`, `SessionEnd`, `Stop`, `PreToolUse`, `PermissionDenied` (one classifier refusal) and `StopFailure` (a turn that ended on an API error the harness's own retries did not clear).
  The last two are how an agent sees its own outages.

## GitHub specifics (the default, well-trodden integration)

- Route git auth through `gh` with `gh auth setup-git` (idempotent; covers **every** host `gh` is authenticated with, so re-run it from any run that clones).
- **Assume multi-host.** Every stored repo reference is `[<host>/]<owner>/<repo>` (bare slug = `github.com`); definition, target, state backup and helper sources may each be on a different host.
  Name the host on every call (`gh api --hostname <host>`, `gh pr -R <host>/<owner>/<repo>`); export `GH_HOST` in `~/.bashrc` when the *target* isn't `github.com` (each run is a fresh shell).
  Authenticating a new host is operator-only (`gh auth login --hostname <host>`): report and stop, never work around it.
  Output for a target stays on that target's host, even if it would render better elsewhere.
- One REST list call sees ~100 items (`per_page=100`) — usually the single batched call a pre-flight needs.
- The agent acts as the token's account: the deployment checklist demands a **dedicated machine/bot account** with minimal scopes (never personal), and README documents the scopes (repo access, org read for rosters, gists if publishing…).
- Hidden HTML comments in posted bodies (`<!-- marker … -->`) survive rendering and are REST-searchable: the standard home for dedup markers and state reconstruction.
- "Secret" gists are unlisted, not private: anything published is reachable by URL and must be called out in README.

## Other integrations

Anything reachable via granted connections + HTTPS or an MCP tool is fair game (issue trackers, wikis, monitoring).
For each, the design answers: how the pre-flight lists items read-only, where dedup markers live, and the REST-equivalent workaround landscape.
Flag unverified surfaces in the handoff; the first onboarding on the pod smoke-tests each one read-only.

## State backup (recommended default)

A dedicated git **remote** for `work/`, named by an env var (`GITHUB_REPO_WORK` pattern), while `work/` stays a **plain data directory, never a git clone** (virtiofs/NFS, above).
All git plumbing is in `scripts/work-backup.sh` (template provided), running in a disposable tmpfs clone under `/dev/shm`:

- **`persist`** (end of every state-changing run): tar-snapshot `work/` into the clone (a pure read of the volume, `--exclude '.git' '.nfs*'`), commit, push.
  Mirror semantics: the remote tip converges to the live `work/`.
- **`restore`** (fresh volume, ONBOARDING): remote → `work/`, data only, never a `.git`.
- **Durability**: nothing authoritative on tmpfs.
  Live state = `work/` (persistent volume), history = the remote, clone = scratch re-seeded whenever missing or broken.
  Worst case loses one unpushed snapshot.
- **Concurrency**: persist is serialized by a mkdir lock beside the clone (lock-or-skip with a stale-lock TTL; a skipped persist is safe since the running one snapshots the same files); across writers, a rejected non-fast-forward push re-seeds from the new tip and re-snapshots.
  Never force-push; a failed push is logged and retried next run.
- The audit asserts no `work/.git` on the volume and counts `.nfs*` junk as an early concurrency signal.

Local-only is fine when everything important is reconstructable from external markers; the interview decides.
