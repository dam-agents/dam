# Agent Skills

Last verified: 2026-09-03

## Overview

This page owns the pod-local half of skills: which skill files sit on one agent, where each of them came from, and how they are mutated. The catalog half — which sources are connected, which skills are installed where, and what was published from which agent — is owned by [skills](skills.md), which also holds the flows that drive this side.

agent-runtime owns the files and nothing else. It scans a source, materializes a skill into the configured paths, walks the disk to enumerate what is there, and publishes a local skill upstream; it never reasons about catalogs, drift, or which user owns what. Every call arrives from the api-server over the harness port, and every credentialed request to GitHub leaves through the paired gateway pod — the only place a token exists.

## Concepts

### Local Skill

A **Local Skill** is a directory present in some Skill Path on the pod, regardless of how it got there — installed from a Source, authored in place, uploaded, seeded from the image at first boot, or copied in by an Agent Kind's Install Command. The pod reports them; splitting them into installed and standalone, and reconciling that against the catalog, happens on the [api-server side](skills.md#skill-installed-skill-ref-local-skill).

A Local Skill's name **on the wire is its frontmatter `name:` when it has one**, and the pod resolves that name to a directory: exact `<skillPath>/<name>` first, then the first directory whose frontmatter `name:` matches, first-wins in Skill Path order. Write Local is what makes the two diverge — it writes a slug directory and forces the frontmatter name to the confirmed display name — so every name-keyed operation goes through the shared resolver rather than treating the name as a directory. Because Publish reads through the same resolver, a Local Skill whose frontmatter name differs from its directory is publishable. Read Local returns the resolved directory basename alongside the files, so a caller names a download from the on-disk identity instead of re-slugging the display name.

### Skill Path

An absolute on-pod directory the harness reads skills from — the `skill-ref` driver's `paths` in the agent's runtime manifest. The agent-runtime resolves it for both install and the read-side views (listLocal / publish); the api-server never passes paths over the wire. Every image inherits the default path declared in platform-base's [`runtime-manifest.yaml`](../../packages/platform-base/runtime-manifest.yaml).

Each per-agent Dockerfile ([`packages/agents/`](../../packages/agents/)) symlinks its harness-native skills dir onto that canonical store, so the harness reads from its own conventional path while the manifest stays harness-agnostic. An install therefore writes once on disk regardless of harness, and no per-agent manifest override is needed.

Install writes the skill directory into **every** configured Skill Path; uninstall removes it from all of them. Scanning the disk for Local Skills walks every path in order and dedupes by directory name (first found wins).

### Skill Origin

Every Local Skill carries a **provenance** verdict, judged by the agent-runtime at read time. The reference is the set of **pristine roots** in the image — exactly two sanctioned locations, both immutable and always in-pod, so no build-time manifest or on-PVC marker is needed (a marker was tried and reverted — third-party baked skills aren't ours to stamp, and the PVC is agent-writable anyway):

1. the **pristine workspace copy** — the directory the image's first-boot seed copies onto the PVC and never touches again, and
2. the **staged-skills dir** — the one place images put system skills that must *not* reach every agent (an Agent Kind's Install Command copies them onto the PVC at create; the shared constant lives in the agent-runtime contract package).

This is a deliberate convention, not a growing list: an image-shipped skill anywhere else will misclassify as user-authored, so new features ship their skills through one of these two locations.

A Local Skill whose directory (with a `SKILL.md`) also exists in a pristine root is **system** when the content hashes match, **system-modified** when they differ (the user edited it, or a template upgrade moved the image ahead of the seeded copy); one with no pristine counterpart is **user**. Identity is the directory name — the same identity install and dedupe key on. A local copy that cannot be hashed (unreadable file, deletion racing the listing) degrades to system-modified rather than failing the listing. The verdict is what lets a reader separate what the user authored from what the image shipped, and it is the gate the api-server publishes behind: it refuses to publish **any** image-shipped skill, modified or not — divergence (a user edit, or an image upgrade) doesn't transfer ownership, so the gate cannot be disarmed by editing a file or by a routine image bump. A skill tracked as an Installed Skill Ref is exempt from that gate: install overwrites its directory, so it always diverges from a same-named baked copy, and it is governed by its Source relationship — publish back to the source keeps working. A pod predating origin classification reports no origin, which readers treat as user — the pre-provenance behavior.

Some image-shipped skills exist to make a platform feature usable. Naming those apart from the image's own built-ins is a reading over this verdict, owned by the catalog side — see [Platform Skill](skills.md#platform-skill).

## The service

Lives in [`packages/agent-runtime/src/modules/skills/`](../../packages/agent-runtime/src/modules/skills/). Exposes a Bearer-authenticated tRPC surface (`install`, `uninstall`, `publish`, `scan`, `listLocal`, `readLocal`, `readSkillFile`, `writeLocal`, `deleteLocal`) over the harness port; the api-server is the only caller.

Six responsibilities:

- **Install** — fetches the source at the requested `version`. For GitHub URLs, uses the REST tarball endpoint (anonymous first, retry authenticated on 404 to distinguish "not found" from "private"); for everything else, shallow-clones via `git`. The paired gateway pod injects the owner's GitHub token on the wire when the request hits `api.github.com`. Resolves the named skill's directory from the source's `path/<name>/` when a [path](skills.md#skill-source) is set, else by walking the [Source Roots](skills.md#source-roots) in order (then top-level); copies it into every configured Skill Path, and returns the deterministic `contentHash`.
- **Scan** — same fetch path; enumerates skills from the source's `path` exclusively when set — failing by name — else across the [Source Roots](skills.md#source-roots) (union, deduped by name, top-level fallback); parses frontmatter, and returns a scanned skill for each. Reporting `dir` is what lets a private source's preview read one pinned file instead of re-resolving the name against the repo on every open.
- **Read Skill File** — one skill's `SKILL.md` at a pinned commit, via the GitHub Contents API against the `dir` the scan reported. **Authenticated by default**, which is the whole point: the gateway's injection is on the hot path, so a repo the api-server can only 404 on resolves here. No repo download, and the decoded file is size-capped like the api-server's own pinned read. It refuses a `dir` that would escape the repo tree, reusing the pod's single copy of that check.
- **Publish** — REST-only. Reads the local skill from disk (size-capped per file and per skill), creates blobs + tree + commit + branch + PR via the GitHub REST API, with author `Platform <platform-publish@users.noreply.github.com>`. Files land under the source's [`path`](skills.md#skill-source) subdir when set (so the same source's subdir-exclusive scan finds the published skill), else under `skills/`. Branch naming: `platform/publish-<slug>-<timestamp>`, where the slug is the skill's name reduced to ref-safe characters — a Local Skill's name is a display name, and git refnames forbid spaces. There is no `git push`.
- **Write Local** — validates and materializes user-uploaded Markdown as standalone Local Skills (one skill per file). Each file lands as `<slug>/SKILL.md` in every configured Skill Path, with frontmatter `name:` forced to the confirmed display name (synthesized when absent). Enforces the same size caps as the read side and rejects the whole batch (before writing anything) on any collision — a slug/directory clash or a display-name clash with an existing Local Skill — so an upload never clobbers an installed or in-place-edited skill.
- **Delete Local** — removes a Local Skill's directory from **every** configured Skill Path. Imperative, unlike uninstall: install/uninstall flow declaratively off an `agent_skills` row that a standalone skill by definition **lacks**, so the driver would have nothing to reconcile. A name that resolves to no directory is a no-op, not an error.

When env credentials arrive over the runtime channel, the agent-runtime reacts by running `gh auth setup-git`, so a private-repo `git clone` invoked from inside the pod also routes through `gh` (and therefore through the gateway pod's credential injector) instead of stalling on a username prompt. It deliberately does not run at boot, where credentials aren't available yet.

## Credential injection on the wire

Agent-runtime never holds a real GitHub token. The paired gateway pod performs the swap:

1. The agent pod's `HTTPS_PROXY` is `http://<agent>-gateway:<envoy-port>` — the per-agent gateway Service DNS. The agent pod's NetworkPolicy admits no other route to TCP 80/443, so credential injection is enforced by the cluster, not by the agent honoring an env var. `SSL_CERT_FILE` points at the cluster-issued MITM CA so TLS termination on the gateway succeeds ([security-and-credentials](security-and-credentials.md)).
2. Envoy renders **three** host-specific filter chains for one GitHub OAuth Secret ([issue #219](https://github.com/dam-agents/dam/issues/219)). One Secret, three chains, three auth shapes; the Secret carries a per-host SDS file (`host-<sha8>.sds.yaml`) for each chain to read:
   - `api.github.com` — `Authorization: Bearer <token>` (REST/GraphQL API).
   - `github.com` — `Authorization: Basic base64("x-access-token:<token>")` (the HTTP Basic shape `git` over HTTPS expects, so private `git clone` / `git fetch` / `git push` work with no credential helper).
   - `raw.githubusercontent.com` — `Authorization: Bearer <token>` (private raw-file fetches).
3. agent-runtime makes its API calls without authenticating — Envoy supplies the credential.

If the user has not connected GitHub, no Secret exists and the request leaves authenticated only when the agent has supplied its own token. The agent runtime exposes `PLATFORM_GH_TOKEN_AVAILABLE=true|false` so wrapper scripts can short-circuit instead of making a 401-eliciting request first.

Since credential env moved to the runtime channel, the flag is derived in-pod from the reconciled env rather than stamped on the pod by the controller. It therefore inherits the channel's best-effort first-spawn semantics: on a cold pod it reads `false` until the first env snapshot arrives, then flips to `true` on the harness respawn that follows. A wrapper that short-circuits on `false` may do so during that boot window — treat it as "not yet known," not "permanently absent."

The same path lets `git clone` of a private repo work without any credential being mounted into the agent pod.

## Invariants

- **Origin is judged at read time against the image, never recorded as authority.** Nothing on the PVC or in Postgres is ever *consulted* to decide provenance — the pristine image copy is the only reference, so it works retroactively on every existing agent and survives the PVC being adversarial ([persistence § threat model](persistence.md)). The dated snapshot a stopped agent serves carries the verdict from the last live read purely so the panel can group what it shows; the next read re-judges from the image and replaces it.
- **agent-runtime never holds a GitHub credential.** Every authenticated GitHub call leaves the agent unauthenticated; Envoy in the paired gateway pod injects the owner's OAuth token from a K8s Secret on the wire. A compromised agent pod cannot exfiltrate that token because it is never mounted into the agent pod — only the gateway pod, and the agent pod's NetworkPolicy admits no route to GitHub other than through that gateway.
- **Publish is REST-only.** No `git push` on the publish path. `git` is used only for cloning non-GitHub sources during install and scan, and that path also routes through the gateway pod's credential injector.
