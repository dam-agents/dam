# GitHub settings

The repository's GitHub settings live in [`.github/settings/`](../../.github/settings/), and those files are the source of truth.
A setting changed in the web UI is drift, and the drift check reports it.

## The files

Each file is the body of the GitHub REST API call that writes the setting, with the API's own field names, written as YAML.
Its path below `.github/settings/` is the endpoint's path below `repos/<owner>/<repo>/`:

- `repository.yaml` holds the repository options (merge methods, branch deletion, features, secret scanning), the body of the repository `PATCH`.
- `rulesets/<slug>.yaml` holds one ruleset, the body of its `PUT`, and is matched to the live ruleset by name; the slug is the name in lower case with dashes.
  The rulesets are the only branch and tag protection: there is no legacy branch protection.
- `topics.yaml`, `automated-security-fixes.yaml` (Dependabot security updates) and `actions/permissions*` (Actions, the default workflow token, fork pull request approval, retention) hold the rest.

A file names only the fields it manages, and only those fields are compared.
The task reads each file as JSON with sorted keys, so key order and comments never count as drift.
Write a comment beside a setting whose reason is not obvious.
Out of scope: secrets and variables, webhooks, deploy keys, team and collaborator access, environments, labels and autolinks.
[`dependabot.yml`](../../.github/dependabot.yml) is a file of its own already.

## Change a setting

1. Edit the file and open a pull request.
2. After the merge, an admin applies it: `mise run github:settings -- apply`.
   The task shows the diff and asks before it writes; `--yes` skips the question.
   It creates or updates rulesets, never deletes one, and warns about a live ruleset that has no file.

To bring a change made in the web UI into the files, an admin runs `mise run github:settings -- export` and opens a pull request with the result.

## Drift check

`mise run github:settings -- check` compares the files with the live settings and fails on any difference, and on legacy branch protection.
The [GitHub settings workflow](../../.github/workflows/github-settings.yml) runs it every night, on demand, and on each push to `main` that changes the settings.
It is not a required check, so drift never blocks a merge.
Red after a settings merge means that the change is not applied yet.

The workflow uses the default `GITHUB_TOKEN`, and no admin token is stored in CI.
That token reads the rulesets without their bypass actors, the topics and the public repository options, but not the merge options, security settings, Actions settings or the legacy branch protection.
The check compares what the token can read and prints a notice for each part it skipped.
Run it locally as an admin for a complete comparison.
