# DAM context

Read this file when the repository is DAM.
Read `.design-desk/dam/PROFILE.md` first: it gives the people, the main screens and the design rules.
This file adds the facts that `AGENTS.md` and the profile do not hold.

- An issue with the `needs design` label is a candidate for this skill.
- Start the app with the `cluster-ops` skill.
- The research steps of the `develop` skill cover duplicate issues, the history of the area, and deliberate decisions.
- Usage analytics (`docs/architecture/usage-tracking.md`) hold the adoption funnel and the use of features.
  Only the `platform-inspector` role can read them, so ask the user for a read.
- `docs/guidelines/code/icons-and-tooltips.md` gives one icon per action, and the tooltip rules.
- The surfaces are the web UI, the `dam` CLI, Slack and Telegram.
  They also include the GitHub issues and pull requests that an agent writes, and shared pages (an artifact link, a public agent).
  Read `docs/architecture/cli.md` and `docs/architecture/channels.md` before you write copy for them.
- While the person is away, reuse the devices that `PROFILE.md` names (Home, the activity in the sidebar, the unread and approval dots) and the approvals panel on Home, before you add a new one.
  A hibernated agent does not run, and some surfaces still render its stored state.
  Design what the person sees and can do then.
- The `grill-me` skill takes the proposal and writes the acceptance criteria.
- Posted text cites staging, never the cluster on your machine.
