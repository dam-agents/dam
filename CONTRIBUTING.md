# Contributing

Thanks for your interest in contributing! This page covers what you need to get a change merged. Issues, pull requests, and roadmap discussion all happen in this repository.

## Before you start

- **Find or open an issue.** Browse the [open issues](https://github.com/dam-agents/dam/issues). For anything bigger than a small fix, comment on the issue (or open one) before you start, so we can agree on the approach and avoid duplicated work. [`docs/guidelines/issue-guidelines.md`](docs/guidelines/issue-guidelines.md) describes how we write issues.
- **Read the architecture first.** Start from [`docs/architecture.md`](docs/architecture.md), and read the page for the subsystem you're changing before you change its behavior. The architecture pages are the source of truth; don't infer the design from the code alone.
- **Learn the vocabulary.** Domain terms (Template, Agent, Session, …) are defined in [`docs/ubiquitous-language.md`](docs/ubiquitous-language.md). Use them in code, docs, and PR descriptions.

## Development setup

You need [mise](https://mise.jdx.dev) on macOS or Linux. The full setup, including the local k3s cluster, is under **Developing DAM locally** in the [README](README.md).

Use `mise run` for everything: building, checking, testing, and cluster operations. Don't invoke `go`, `pnpm`, `helm`, `kubectl`, and similar tools directly; mise pins their versions and environment. `mise tasks --all` lists every task, and [`docs/guidelines/mise-tasks.md`](docs/guidelines/mise-tasks.md) explains how tasks are organized.

Before you push, run:

```sh
mise run check
mise run test
```

To run the checks before every commit:

```sh
mise generate git-pre-commit --write --task=check
```

## Making changes

- **Code rules.** Language-level rules are indexed in [`docs/guidelines/code/index.md`](docs/guidelines/code/index.md). Scan the index and open a rule when its trigger matches your code.
- **Comments.** Follow [`docs/guidelines/comment-guidelines.md`](docs/guidelines/comment-guidelines.md).
- **Docs.** If your change alters how a subsystem behaves, update its architecture page in the same pull request. See [`docs/guidelines/documentation-guidelines.md`](docs/guidelines/documentation-guidelines.md).
- **Branding.** Don't hardcode the product name in code. User-visible branding flows from the Helm `brand.*` values.
- **Keep pull requests focused.** One logical change per pull request is easier to review and merge.

## Commits and branches

- **Branch names** follow `type/short-description`, for example `feat/session-history` or `fix/stale-timer`.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): short summary`. Types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `revert`, `style`, `perf`, `ci`, and `build`. The scope is optional but encouraged, for example `fix(ui): …`.
- **Sign off every commit** for the [Developer Certificate of Origin](https://developercertificate.org) with `git commit -s`. The sign-off certifies that you have the right to submit the change under the project's license.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests where they apply.
3. Run `mise run check` and `mise run test`.
4. Open a pull request that links the issue it addresses and explains what changed and why.

One of the [maintainers](MAINTAINERS.md) will review it. Please respond to review comments by pushing follow-up commits to the same branch.

## Questions

Ask in [GitHub Discussions](https://github.com/dam-agents/dam/discussions), or open an issue. [`MAINTAINERS.md`](MAINTAINERS.md) lists who maintains the project.

## Working with coding agents

The repository is set up for coding agents such as Claude Code: [`AGENTS.md`](AGENTS.md) holds the conventions agents follow, and project skills live in [`.agents/skills/`](.agents/skills/), which Codex and Pi read directly and Claude Code reads through the `.claude/skills` link. You're welcome to use agents; you're responsible for reviewing and understanding everything you submit.

## License

DAM is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
