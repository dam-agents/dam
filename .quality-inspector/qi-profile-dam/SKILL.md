---
name: qi-profile-dam
description: >-
  Product profile for testing DAM — the agent platform — with the quality-inspector agent (helm-k3s engine) — and what a tester should know about DAM from a user's point of view.
  Load when quality-inspector freezes acceptance criteria or writes tests for DAM.
---

# DAM — what a tester needs to know

DAM runs AI coding agents (Claude Code, Codex, Pi, Bob) in isolated environments.
The nested install is a fresh platform at `http://localhost:4444` with four test accounts from `credentials.env` (local accounts of the bundled sign-in service); the suite signs in as the owner.

## Test accounts

DAM has no teams or workspaces: every account owns its own agents, connections, schedules and artifacts, and sees another account's work only through what that account shares (an artifact link, a public agent, a shared connection).

| Role        | Account        | May                                                                                                  |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `OWNER`     | `qa-owner`     | everything a user may, plus the usage analytics report (an inspector)                                |
| `MEMBER`    | `qa-member`    | everything an ordinary user may with their own work; no usage report (a "We are sorry" page)         |
| `INSPECTOR` | `qa-inspector` | what `MEMBER` may, plus the usage analytics report                                                   |
| `OUTSIDER`  | `qa-outsider`  | the same as `MEMBER` — kept apart for checks that someone else cannot see or change the owner's work |

No account sees the Slack workspaces tab in Settings: the QA install sets no Slack app.
Every Settings page still asks `GET /api/slack/install/status` and gets a 404; that is expected (`expected_requests` in `profile.json`), not a defect.
None of them can see, open or change another account's agents, connections, schedules or artifacts unless it was shared with them.
There is no read-only account: any signed-in user may create their own agents, so DAM provides no `VIEWER`.
Builds published before these accounts were added have only `qa-owner`; there another account cannot sign in, so a check that needs one is `blocked` on such a build, never failed.

## Vocabulary a user sees

- **Agent** — a running harness with its own workspace; created from a template or a starter kit, opened in a chat view; it stops on its own when idle and starts again when used.
- **The navigation rail** — expanded by default, with labels; its header carries the install's brand mark, which opens Home, and a *Collapse navigation* chevron beside it.
  Collapsed, the header carries only an *Expand navigation* chevron, always drawn rather than swapped in on hover, and no brand mark or brand text.
  This change opens the rail expanded once in every browser, whatever the person had collapsed before, and their next collapse sticks for that browser.
  In the chat's header the agent's avatar, name and state dot open the agent menu: *Rename* (a dialog), *Artifacts* and *File tree*, which open those sections beside the conversation, stacked when both are open, and show a check while open, *Browser* and *Processes* for an agent that has them, *Git Changes* once the agent has a repository, *Add editors* and *Agent settings*.
  Files and Artifacts start closed for an account that never opened them, and each stays as the account last left it; the processes and the running count (*N running*) open in a panel beside the conversation.
  The notifications bell sits in a thin strip across the top of the chat.
  A new chat's empty message box shows example prompts one after another, with a *Tab* hint; Tab puts the one showing in the box, and the box's placeholder (its accessible name) is still *Message…*.
  The settings dialog's banner shows the agent's avatar, which opens the avatar picker, and its name; its General section starts with the agent's rename and avatar picker.
  The agent menu's *Agent settings*, and every wrench, *Agent settings* — an agent's row in the sidebar, an agent card on Home — open the same dialog over whatever is on screen, with no chat needed behind it.
  The agent's name above a reply, the empty chat's avatar, the assistant greeting's name and the model picker's *Manage providers* open the same dialog; there is no agent settings page, and the dialog has no link to one.
  An old agent link, `/sandboxes/<agent id>/<section>` as in a Slack message, opens the agent's chat with the dialog on that section.
  The dialog lists every section as a title with its summary under it; a section that needs attention has a small orange dot.
  The list scrolls up and down when it does not fit, never sideways.
  The **+** button at the start of the message box (*Add*) opens a menu: *Attach file* (the file picker the box always had), then *Skills*, *Schedules* and *Connections*, each with a count of what the agent has on.
  Each of the three opens a list with *Back* and *Manage* (the same section of the agent's settings): a skill's switch installs or removes it while the agent runs, a recurring schedule's switch pauses or resumes it (a one-time task has none), and the Connections list shows the connections the agent holds, one card per service, each with its ⋯ menu; *Add connection* grants more.
  A schedule's ⋮ menu offers *Run now*, *Edit schedule* and *Delete schedule*, as on the Schedules section.
  *Add source*, *Create schedule* and *Add connection* open the usual dialogs; *Or, describe to create* (skills and schedules) leaves *Create a skill that...* or *Every morning at 9am...* in the box in place of any draft, and sends nothing.
- **Ask <assistant>** — the link under a failure that asks the account's assistant about it, labelled with the install's assistant name (*Ask Dammy*).
  It shows on the error card under a reply whose turn failed, on a crash notice about one agent (out of memory, storage full, stopped answering), on the overlay that says an agent hit an error or is over budget, and on a schedule card whose last result is *Failed* or *Missed* — not on a held, pending or succeeded one, not on a sleeping agent's overlay, and not on the provider-failure card.
  It is there only for the agent's owner, only when the account has an assistant, and never in the assistant's own chat.
  Choosing it opens a new chat with the assistant with the agent, the session or schedule, the time and the first line of the error already in the message box, and sends nothing.
  A crash notice carrying the link stays until it is closed, so *Tab* reaches the link and *Enter* opens the chat as a click does.
- **Starter kit** — a ready setup an agent is created from (connections, schedules, size).
  Its tile and its modal say who publishes it: "By" the brand, with a check mark, for the platform team's kits, or "By" a named user, linked from the modal.
- **Connection** — a stored credential (model provider, GitHub, Slack…) granted to agents.
- **Schedule** — a task on an agent, recurring or one-time (*At a time*, with a date and time); it runs on its own and starts an agent that stopped while idle.
- **Idle** — what the owner's list of agents says of an agent with nothing to do, whether it still runs or has stopped after the install's idle timeout (5 minutes by default; the UI has no setting for it).
  The UI shows no sleep state and no button to wake an agent: opening an agent's chat, or a page that needs it running, starts it, with a short "starting" wait at most.
  While waiting for an agent to stop, watch only that list: opening its chat starts it.
- **Artifact** — a work product an agent or user publishes, shareable by link.
- **Settings** — API keys, providers, connections, appearance, usage, schedules, about.
- **DAM connection** — the connection that lets an agent act as its owner on the install; an account's own, made from an agent's Connections page once the experimental feature `damConnection` is on for it.
  Turning that switch off leaves every connection and grant working and only stops new ones being offered.
- **Home** — what changed since the user last looked; agents, usage, spend.
- **Tool-call approval** — an agent's call of an MCP connection's tool, held while that connection is in *needs approval* (experimental feature `mcp-tool-approval`).
  It waits in the approvals bell as a card headed *Wants to use <tool> on <connection>*, in a toast, and, with `chat-network-approvals` on, as a card titled *Allow this tool call?* in every open conversation of the agent.
  The card shows the call's arguments as JSON, says *The arguments were cut: …* when they are larger than 64 KiB, and offers only *Allow once* and *Deny*; the next call asks again.
  On a Slack Account connection, a call that posts shows *Posts as you to <channel id>* and the message text in place of the JSON.
  The same call sent again while one waits shows as one card with a request count.
- **Assistant** — an ordinary agent the platform makes for a person when the install offers it: it is created under the install's assistant name (Dammy by default) and tracked from then on by a small record per account, so it appears in the agent list and the sidebar like any other agent and can be renamed, shared, bound to a channel and deleted as any other agent can.
  The record, not the name, is what makes it the assistant: renaming it keeps it one, and an agent the account makes under the same name is never it — that agent only stops a new one being created, and never opens on the greeting.
  It is the experimental feature `dambledore`, and the one feature **on by default**: an account that stored nothing has it on, so a fresh account and an existing one both get Dammy at their next request, and the switch under Settings → Experimental features (its row is labelled with the install's assistant name and described as *An assistant that can control DAM for you.*) is how they decline.
  Switching it on after turning it off makes Dammy, unless the account already has an agent under that exact name, matched case-sensitively: the name belongs to whoever holds it, so nothing is made beside it.
  Deleting the Dammy the platform made and switching the feature off and on again makes a new one, unused; renaming it does not, since the record still names it, and the renamed assistant keeps its greeting while it has never been used.
  There is never a numbered second name like "Dammy 2", and no agent is ever renamed to free the name.
  With `on` the install pins it (no switch): a fresh account gets one at its next request, once, so deleting it there is not undone by a reload — the reset is the way to ask again.
  With `off`, nobody does.
  Turning its switch off deletes nothing — the agent stays in the list — and only hides what the next bullets describe.
  An assistant that has never sent anything opens its chat with a **greeting** in its own voice — the person's first name, its name and the install's brand, e.g. *Hi Jenna!
  I'm Dammy, your personal DAM agent.* — and under it five labelled **ideas**: *Artifact:*, *Schedule:*, *Knowledge base:*, *Skill:* and *DAM:*.
  A click on an idea fills the message box and sends nothing; the empty box itself hints *Message* and the assistant's name, never an idea's text.
  The avatar the platform's own Agent unlocks plays its celebration on that first landing, beside the message box; an account whose avatars are all seen has none left to unlock, so it plays nothing.
  A person whose assistant has never been used lands in its chat instead of Home, whatever it is called; the greeting is gone once it has had a conversation, so a New chat opens on the ordinary new-chat page.
  After the greeting, every chat of the assistant has a collapsed *Try something new* row above the message box: opened, it shows three ideas and *Show all*, without the idea the chat started from.
  Where the install has the shared CurveBender, its notice appears in the assistant's chat exactly as in any other agent's.
  The assistant marks **the person's first result** itself once it has actually got them one — a schedule set, an artifact made, a knowledge base saved — and that is what finishes their onboarding: the Get started checklist then counts the task for a schedule or an artifact as done, and the record keeps the kind, what it was and when.
  A knowledge base finishes no checklist item, because the checklist has none for one; the result is recorded all the same.
  Experimental features ends with one **Onboarding progress** card — *Restarts your onboarding.
  Nothing in your account is deleted.* — and one button, the only onboarding reset there is: it asks first, locks every avatar again and starts the Get started checklist over, the assistant's own create task counting as done once its celebration has been dismissed — wait for it and click *Nice* before asserting the checklist, since until then the task is unlocked but unseen.
  For an account the assistant is on for it also gives them a first open in it: the greeting comes back, a Dammy the platform made is reused with its use forgotten, one that is gone is made again when the name is free, and the account is taken to the entry route.
  For an account it is off for the card does the checklist alone and leaves the account where it is.
  The assistant can also run a weekly **security check** of the account's whole setup: the experimental feature `security-check`, off by default, whose row under Settings → Experimental features is labelled *Security check* and says each check spends the model budget.
  Switching it on adds an ordinary schedule named *Security check* to the assistant's schedules, and switching it off removes that schedule; an account with no assistant gets an error and the switch stays off.
  When a check found something, the approvals bell shows one card under the assistant's name, headed *Your setup has N security problem(s)*, with one line per problem and a *Review in chat* button that opens the session of that check.
  *Dismiss* hides that card until the next check reports; nothing in the setup changes until the person agrees in that chat, and deleting the schedule takes the card away.

## What the nested install cannot do

- No outbound network from inside the nested cluster beyond the sandbox accounts below and the CurveBender model proxy: real model providers (unless lent, or reached with the instance's CurveBender key, below), Telegram, and any GitHub or Slack other than the sandbox's do not work.
  An AC that needs any of them is `testable: no — external dependency`, unless it only checks that the UI offers or records something.
- **Sandbox accounts** (`sandbox` in `profile.json`, set up at the inspector's onboarding) make two services real, each only when its credentials are set:
  - **GitHub** — one repository of a throwaway organization, `profile.sandbox_github_repo`, and a test GitHub user who owns it.
    An agent reaches it through a **GitHub** connection, made either way a user makes one:
    **Authorize with GitHub** (OAuth, its button *Continue to GitHub*), or a personal access token (Settings → Connections → GitHub → *Connect with a personal access token*, its button *Connect*), whose value is `E2E_SANDBOX_GITHUB_TOKEN` and which may read the repository, write its issues and pull requests, and push and delete branches.
    DAM checks a token when it is saved and shows the test user's login as the connection's account.
    With OAuth the install's GitHub OAuth App is the sandbox's, so the form needs no client ID; the browser leaves DAM for GitHub's sign-in.
    Right after the step that sends it there, call `githubSignIn({ screen, browser })` from `suite/lib/sandbox.ts`: it signs in as the test user (password and a fresh authenticator code), gives the App's consent when GitHub asks, and returns once the browser is back on DAM.
    Never drive GitHub's pages yourself, never type a GitHub value in a test, and never open another GitHub page: only the sign-in's own pages are reachable.
    Back on DAM, the sign-in is not yet a connection an agent can hold: DAM asks what the connection reaches.
    Choose **Full access**: an OAuth App's sign-in cannot be narrowed to repositories, and the test user reaches only the sandbox organization.
    The connection then shows the test user's login (`sandbox.githubLogin()`) as its account; `sandbox.githubUser()` says whether this instance has the test user.
    A **second test user** (`github2`), a member of the same organization who may write the same repository, signs in through the same App: `githubSignIn({ screen, browser, who: 'second' })`, its login `sandbox.githubLogin('second')`, its token `E2E_SANDBOX_GITHUB2_TOKEN`, `sandbox.githubUser('second')` whether this instance has it.
    GitHub stays signed in, so each test user signs in from a session of its own: the second from another DAM account's session (say `outsider`) than the first, never after the first in the same one.
    Check what the agent did on GitHub through what DAM and Slack show — its reply, its chat.
    The one exception is a pull request: `sandboxPull(id)` finds the newest one of the sandbox repository whose title holds the run's id (its link, title, state and branch), so an AC that the pull request "appears on GitHub" checks that it is `open`.
    Never read the repository's files or any other GitHub page.
    The agent clones and pushes the sandbox repository over git, and opens the pull request through GitHub's REST API; GitHub's GraphQL endpoint stays closed, so `gh pr create` fails and the agent has to fall back to the REST call — a criterion failed only by that is a model mistake to triage, not a product failure.
  - **Slack** — one channel of a throwaway workspace; DAM's Slack app is installed there and connected at install, so the workspace needs no install flow.
    An agent joins it under the agent's **Channels** → *Add Slack channel*, which opens the dialog *Connect Slack channels*.
    Its picker lists the channels that the signed-in user and DAM's bot are both in, by name, and only for a user who linked their Slack account to DAM.
    With the dialog open, call `connectSlackChannel({ screen })` from `suite/lib/sandbox.ts`: it adds the sandbox channel and taps *Connect*.
    The test person writes and reads there only through `suite/lib/sandbox.ts`: `botUserId()` to mention the agent, `personSays(text, threadTs?)`, `botReplies(ts)`.
    A **second test person** (`slack2`) in the same channel writes with `personSays(text, threadTs?, 'second')`; `sandbox.slack('second')` says whether this instance has it, and `botReplies` never counts either person's post as the agent's.
    The test person's posts count as app posts, and DAM rate-limits bot and app posts per conversation (a channel's top level, or one thread).
    When more than ten of them arrive in one conversation within a minute, DAM drops them there for five minutes and posts one notice that starts with `:pause_button:`; `botReplies` would return that notice as a reply.
    So each request goes in a thread of its own: a root without a mention (`personSays(text)`), then the mention in that thread (`personSays(text, root)`), then `botReplies(root)`.
    A task that should post in Slack gets a thread of its own the same way: the root, then its link (`threadLink(root)`) in the task's prompt, then `botReplies(root)` for the agent's post — a post at the channel's top level would share one count with every other run's posts there and could be dropped.
    A Mock agent answers a Slack mention in the thread with its scripted reply, without a model.
  - **The Slack Account connection** is not a channel: it gives an agent its owner's own Slack, through Slack's sign-in (Settings → Connections → Slack Account).
    Its form asks what agents can do with it: **Read only**, the default, or **Can post as me**.
    Every row of the connection, also under an agent's **Connections**, says which in the line under its name (*Read only: …* or *Searches, reads and posts as you*), and one that can post also carries the red mark *Can post as me*; *Change access* in the row's menu switches between them.
    With *Read only* the platform refuses every Slack tool that posts or changes something, and the agent says so in its reply.
    With the experimental feature `mcp-tool-approval` on, that choice becomes the **tool mode** of every MCP connection with a credential (the Slack Account, a custom MCP server with OAuth or a header): **Read only**, **Needs approval** or **Allow all**, at connect and in the row's *Tool access* dialog.
    The dialog also lists the server's tools under *Read tools* and *Write tools*, with *Refresh*.
    The row's line names the mode (*Allow all: …*, *Read only: …*, *Needs approval: …*); *Needs approval* carries an amber mark, and *Allow all* carries the red mark only on the Slack Account, which defaults to read only.
    A custom MCP server with no auth offers allow all alone, so it shows no picker.
    A connection left in *Needs approval* when the feature is turned off keeps its amber mark and its dialog (*Change access*), where *Needs approval* is the current card and the owner can only switch away from it.
    A test never drives Slack's own sign-in pages, so a criterion that needs the connection signed in is `blocked — Slack sign-in`, never failed; one that checks only the form, the marks or the dialog stays testable.
  - **Testability limit — Slack account linking.**
    A user links their Slack account only inside Slack: `/dam login` (then a DAM sign-in page), or `/dam bind` typed in the channel itself.
    The test person writes through Slack's API, which cannot send a slash command, and a test never drives Slack's own app.
    So on this install no DAM account has a linked Slack account, and the picker shows only the text that asks the user to run `/dam login`.
    `connectSlackChannel` then throws `SlackNotLinked`.
    A criterion that needs an agent connected to the sandbox channel, and each later criterion that needs that connection, is `blocked — Slack account linking`, never failed.
    A criterion that checks only what the dialog offers (the `/dam login` and `/dam bind` instructions) stays testable.
    When a later build links the owner's account at install, the picker lists the channel and the same test passes with no change.
  - **Cleanup after a pass only**: after the last criterion, `closeSandboxPull(pull)` closes the run's pull request and deletes its branch, and the test deletes its agent; a failed run keeps both for its report.
  - Filing an issue or deciding anything needs a real model.
    Two ways make it testable:
    with `lend_model` on, the test creates an **Anthropic** connection whose key is the lent placeholder (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN` in the test's environment), and the agent uses a Claude Code template;
    when the instance credential `E2E_LITELLM_CURVE_BENDER_TOKEN` is set, the test creates the **CurveBender (own key)** provider connection whose key is that value, and the agent uses a real model that key serves.
    With neither, such ACs are `blocked`, naming `lend_model` and `E2E_LITELLM_CURVE_BENDER_TOKEN`.
  - A sandbox whose credentials are not set leaves its ACs `testable: no — external dependency`; so does a second user or person this instance lacks, for an AC that needs two.
- Agents answer through the **Mock** harness template (a scripted mock agent, the profile's `mock_image`), where an agent can run at all (see *Agents run only where* below): it replies "Hello from the mock agent."
  to every prompt and never calls a model.
  An AC about what an agent says or decides is judged only on what the UI shows around that reply; with `mock_image` set empty, an AC that needs an agent to reply or run is `blocked`, not failed.
- The harness templates (Claude Code, Codex, Pi, Bob) boot the default image, which bakes their tools, but no real model provider is reachable (above) unless the instance's CurveBender key is set, so without it an AC about such a harness's own replies is `testable: no — external dependency`; with it, the reply is judged like any other; one that only checks what the UI offers or records for it stays testable either way.
- What a user creates with a free-text field (a schedule's prompt) needs an agent first; the agent's name is itself free text and shows wherever the agent is listed.
  The injection canary therefore names one Mock agent with its text (`canary` in `profile.json`) and deletes it.
- No service mesh: the VM's kernel cannot run Istio, so the nested install runs without it.
  Network isolation between agents is not enforced — an AC that one agent cannot reach or act as another is `testable: no — no mesh`.
- Agents run only where the inspector's VM has `/dev/kvm`: every agent runs as a virtual machine on the owner's VM runner, which needs it.
  `bash "$HOME/scripts/env.sh" status` says `"kvm": true` when the VM has it (the platform that hosts the inspector gives it nested virtualization) and `false` when not.
  With `false`, an agent is created, shown, shared and configured as usual, but none of its sessions starts: DAM reports that it "can't start" because the owner's VM runner cannot be scheduled.
  That message is this limit, not a product failure: an AC that needs an agent to start, reply or run a task (the Mock agent included) is `testable: no — no VM agents`; one that only checks what the UI offers or records stays testable.
  With `true`, that message, or an agent that never reaches running, is a finding like any other.
- In a platform Environment (`env.sh where` says `environment`) the install is the same, at the same `localhost` address for the tests.
  A build older than `0.0.0-main.9300` or `0.2.24` gets no public addresses there, so a kept Environment of such a build is no use to a person: release it (`env.sh release <label>`) instead of keeping it, and say so in the report.
- No email, no SSO federation, no real billing.

## Tested elsewhere

DAM's own test suite runs on every change, with the Mock agent and every third party mocked, and keeps these flows true.
A scenario or an exploration uses them as its Given and does not check them again; an issue's criteria are tested whatever this list says.
A flow that needs real Slack, real GitHub, a real model or real time passing is not on it.

- Signing in through the sign-in page and accepting the terms; a link opened before signing in still opens after it.
- Creating a connection with a custom header; recreating a disconnected connection grants it to its agents again.
- Creating an agent in one click from the Generalist card, and a Mock agent with a connection and the default provider.
- Exchanging messages with an agent; a message sent while the agent is still answering keeps each reply under its own message.
- Deleting an inactive and an active session, landing on the right page.
- The sidebar: dragging agents into a new order, sessions newest first, pinning a session above every agent, filtering and deleting a pinned session.
- API keys and their scopes: a manage key creates and deletes agents, an operate key runs them, a read key only looks, and no key manages other keys.
- Network rules for one path, and a waiting network approval shown in the open conversation.
- Sharing a knowledge base.
- Satellites: registering a machine, granting it to an agent, draining and removing it, and seeing it among Connections.
- Slack with a mocked workspace: a channel any member drives, binding and unbinding from the chat, replies to unmentioned messages.
- Connecting a Slack channel picked by name for a user with a linked Slack account, and the refusal of a channel the user is not in.
- An agent that hibernates and wakes, restarts or loses its machine, with its files intact, and a scheduled task's fire reaching it.
- The browser panel showing the user and the agent the same tab.

## Versions

Builds are chart versions: `0.0.0-main.<n>` after every merge to main, `X.Y.Z` releases.
Candidate `main` = the newest dev chart; baseline `release` = the newest release.
There is no build of a pull request: a change is tested after it merges, in the next `0.0.0-main.<n>`.

## Design

- The words DAM retired are `design.retired_words` in `profile.json`, from its glossary.
  "Sandbox" is still right for the machine an agent runs in (an Environment, a "sandbox image"), "image" for a picture or what an agent runs, and "shell" in *Bob Shell* or a shell command.
- The UI follows the system's light or dark theme until the user picks one under Settings → Appearance.

## CLI and API

The published CLI is the npm package `@dam-agents/cli` (`dam`).
In a test: install it into `work/suite`, set `DAM_SERVER` to the app URL and `DAM_TOKEN` to an API key the test's setup creates under Settings → API keys; `--json` on every read verb.
The HTTP API takes the same key as a bearer token.

## Channels

`candidate_channel`: `main` (default) \| `release`.
`baseline_channel`: `release` (default) \| `none`.
Releases before `0.2.20` cannot install without the mesh; the `release` channel already picks a later one.
