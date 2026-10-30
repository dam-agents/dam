# qi-profile-dam

The DAM profile for the [quality-inspector](https://github.com/dam-agents/quality-inspector) agent — black-box QA that tests DAM through its UI, built by built, without reading this repository.
It is data only: the inspector's `helm-k3s` engine runs the published chart in a nested k3s cluster inside the inspector's VM from `profile.json` → `engine_config`.
Contract: quality-inspector `docs/profile-contract.md`; engine configuration: `engines/helm-k3s/README.md` there.

- `profile.json` — the chart, its channels (`main` = `0.0.0-main.<n>`, `release` = `X.Y.Z`), the prerequisites (cert-manager, Gateway API CRDs, Istio CRDs without the mesh dataplane), the Helm values for a QA install with four generated test accounts (owner, member, inspector, outsider — `keycloak.testUser` and `keycloak.extraTestUsers`), egress, the injection canary's object (one Mock agent, its text in the name), requirements, config keys.
- `virtualization.runner.resources.limits.memory` and `virtualization.imageCache.hostPath` are the VM runner values the chart refuses to render without.
- `kvm-device-plugin.yaml` — a copy of `helm/extra/kvm-device-plugin.yaml` (keep its digest in step), applied as a `file` prerequisite: it hands the VM's `/dev/kvm` to the VM runner as `squat.ai/kvm`, which `virtualization.runner.devices` names.
  The install does not wait for it: an image it cannot pull stops only the agents, not the install.
  `engine_config.kvm` opens the device to the runner's user namespace and moves the kubelet's root off the VM's overlay root, and `host_dirs` does the same for the node directories the chart hands the runner (quality-inspector 3.44.0 or later; an older engine warns on the two keys and the runner pod does not start).
  Agents start only where the platform that hosts the inspector gives its VM nested virtualization (DAM's chart does by default).
  Its image comes from `ghcr.io`, which `egress` names; the layers come from `pkg-containers.githubusercontent.com`, a GitHub host a profile may not name, which the `trusted` preset allows.
- The **Mock** harness template (`mock_image`) is on by default: the scripted e2e mock agent, pinned to the source sha it was built from (`quay.io/dam-agents/mock` has no release tags).
  It carries the agent runtime of that sha, so bump it when a chart change needs a newer runtime: `mise run image:resolve -- source-sha mock` on main gives the tag.
- `environment` — the platform Environment the inspector may run the nested install in (quality-inspector 3.45.0 or later; its `nested_target`).
  Its four endpoints `app`, `keycloak`, `share` and `content` share port 4400, where the engine's host-name bridge (`environment_bridge`, the chart's own Envoy image) listens and passes requests to the ingress on 4444.
  The `@environment` overlay gives the chart those public addresses (`urls.*`, `scheme`) and keeps the inspector's own address on the backchannel, `http://localhost:4444`, which the inspector forwards over the Environment Link.
  Its `tags` limit it to the builds with the backchannel (#5803): `0.0.0-main.9300` and later, `0.2.24` and later.
  An older build in an Environment installs with the `localhost` addresses only: the tests run, but a person cannot sign in at the Environment's address.
  `account: owner` — a person who opens a kept Environment signs in as the owner test account (`qa-owner`); its password stays in the inspector's `work/env/credentials.env`.
  No `storage`: the platform's default, because the owner's runner claim holds the inspector's own disk too.
- The images the chart takes from `mirror.gcr.io` are in `egress`, so the nested product stays inside the inspector's egress, which is deny-by-default on GitHub.
- The cert-manager and Gateway API manifests are `github.com` release files the inspector's kit opens (quality-inspector 3.1.0 or later); the `trusted` preset allows the hosts GitHub redirects them to, so `egress` names neither.
- `no-mesh-marker.yaml` — the `kube-system/platform-local-no-mesh` ConfigMap that lets the chart take `istio.enforce=false`.
  The inspector's VM kernel cannot run the Istio ambient dataplane, so the nested install runs without it; applied as a `file` prerequisite (quality-inspector 2.21.0 or later).
- `sandbox` (quality-inspector 3.4.0 or later; the GitHub sign-in 3.9.0) — throwaway accounts the inspector's operator creates once at onboarding: a GitHub test user with an organization, one repository, an OAuth App and a fine-grained token (`sandbox/github.md`), and a Slack workspace with DAM's app and a test person (`sandbox/slack.md`).
  A second GitHub test user in that organization (`github2`, `sandbox/github-second.md`) and a second test person in that channel (`slack2`, `sandbox/slack-second.md`) let a test act as two people.
  They are optional and accounts of their own: the overlays `@sandbox:github` and `@sandbox:slack` do not wait on their lines, and `bin/sandbox check` passes while all of an account's lines are empty (the kit's `verify-onboarding.sh` still lists them as not set).
  The install connects the workspace through `apiServer.slackAppToken` and the legacy `apiServer.slackBotToken` import (overlay `@sandbox:slack`), takes the OAuth App as its GitHub default (`apiServer.oauthAppDefaults.github`) and lets the nested gateways reach the VM's gateway (`controller.gatewayEgress.extraCidrs`, both overlay `@sandbox:github`).
  The GitHub sign-in's pages are the only `github.com` paths in `egress`, each with its method — the inspector's kit admits no other shape there; `suite/lib/sandbox.ts` → `githubSignIn` drives them, so a test never names GitHub.
  `controller.gatewayUpstreamExtraCAs` is the VM gateway's CA, so nested gateways and the api-server trust the TLS it intercepts.
  `bin/sandbox check` proves the accounts; `suite/lib/sandbox.ts` is the test person; `egress` names only the sandbox repository's issue and pull-request writes, git's clone and push of it (quality-inspector 3.9.0 or later), the GitHub sign-in, DAM's check of a GitHub token (`GET api.github.com/user`) and Slack.
  `suite/lib/sandbox.ts` → `connectSlackChannel` picks the sandbox channel in the *Connect Slack channels* dialog.
  That picker lists channels only for a DAM user who linked their Slack account, which a user does only with `/dam login` or `/dam bind` in Slack, and no Slack API sends a slash command.
  So the Slack journeys stay blocked until the QA install can link the owner's account to the test person at install; `SKILL.md` states the limit.
- `operator_credentials` (quality-inspector 3.47.0 or later) — one value the inspector's operator fills once, not an account to create: `LITELLM_CURVE_BENDER_TOKEN`, a real CurveBender (LiteLLM) API key for `litellm.cb.ete.res.ibm.com`, seeded empty as `E2E_LITELLM_CURVE_BENDER_TOKEN` and reported by `verify-onboarding.sh`.
  Optional: without it a criterion that needs a real model is `blocked` (`SKILL.md` → *What the nested install cannot do*).
  `egress` names `litellm.cb.ete.res.ibm.com` host-wide, so the nested agent's model calls with that key pass the inspector's gate.
- `scenarios/` — the smoke regression suite: the journeys the inspector replays nightly, listed under [Smoke regression suite](#smoke-regression-suite).
- `SKILL.md` — DAM from a tester's point of view: vocabulary, the test accounts and what each may do, what the nested install cannot do, and what the per-PR e2e suite already keeps true (`## Tested elsewhere`; a PR that adds or removes such a flow there updates the list).
  User-facing only — never implementation detail.

**Keep it in step with the chart.**
A change that alters what a fresh install needs — a new prerequisite, a renamed value the QA install sets (`keycloak.testUser`, `keycloak.extraTestUsers`, `terms`, `ingress.catchAllAppHost`) — updates `profile.json` in the same PR.

## Smoke regression suite

The journeys every release must keep, one file each in `scenarios/`.
What goes in, how it stays small and when a journey leaves: [`docs/guidelines/smoke-regression-suite.md`](../../docs/guidelines/smoke-regression-suite.md).
Adding, renaming or removing a file updates this table in the same PR.

| Journey                                                                                               | What it walks                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`a-users-full-day-from-login-to-slack`](scenarios/a-users-full-day-from-login-to-slack.md)           | create an agent, connect GitHub through the sign-in, a pull request asked for in chat, connect Slack, a scheduled task posts to Slack while the agent sleeps     |
| [`agent-files-a-github-issue-asked-in-slack`](scenarios/agent-files-a-github-issue-asked-in-slack.md) | connect GitHub and Slack, an issue asked for in a Slack thread                                                                                                   |
| [`agent-opens-a-pull-request-asked-in-slack`](scenarios/agent-opens-a-pull-request-asked-in-slack.md) | connect GitHub and Slack, a pull request asked for in a Slack thread                                                                                             |
| [`cli-work-comes-back-as-a-shared-artifact`](scenarios/cli-work-comes-back-as-a-shared-artifact.md)   | an API key drives the agent from the CLI, Home, an artifact and its new version, a public link opened and closed for the member, the usage report and its denial |

## Delivery

The inspector's operator adds this repository as a skill source with path `.quality-inspector` and assigns `qi-profile-dam`; the platform fetches only this directory.
The inspector's kit (quality-inspector 3.0.0 or later) opens `GET /repos/*/*/contents/.quality-inspector/*` and `GET /repos/*/*/contents/.quality-inspector?*` for every repository and nothing else of it, so this directory needs no egress rule of its own.
Keep `.quality-inspector/` free of symlinks and submodules: the Contents API answers a symlink to a file with that file's content, and the inspector's gate fails on one.

## Egress rules

An inspector that runs on DAM needs no rule typed by hand: it proposes each `egress` entry it lacks to its owner with the platform's `egress_proposal` tool (`propose`), with the entry's host, method and path and its `why` as the reason, once `{profile.<key>}` is filled in.
The owner allows each one where waiting approvals show — on Home or in the inspector's chat — and the rule is written as the owner would type it; its `status` action tells the inspector which ones are allowed.
An older DAM without the tool keeps the manual path: the operator adds the rule in the agent's network settings.
`bin/sandbox check` names a missing rule the same way.

## Config (`work/CONFIG.md` of the inspector)

| Key                                                                                                            | Default                                    | Purpose                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `profile.chart_ref`                                                                                            | `oci://quay.io/dam-agents/charts/platform` | chart the builds come from                 |
| `profile.mock_image`                                                                                           | `quay.io/dam-agents/mock:<sha>`            | mock harness image so nested agents answer |
| `profile.istio_version`, `profile.cert_manager_version`, `profile.gateway_api_version`, `profile.helm_version` | see `profile.json`                         | nested prerequisites                       |
| `profile.sandbox_github_repo`                                                                                  | empty (asked)                              | the sandbox repository, `<org>/<repo>`     |

## Sandbox accounts

| Account   | The operator creates                                                                                                                                                 | Lines in `work/env/credentials.env`                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `github`  | a test user with an authenticator code, an organization, one repository, an OAuth App, a fine-grained token (`sandbox/github.md`)                                    | `E2E_SANDBOX_GITHUB_TOKEN`, `_LOGIN`, `_PASSWORD`, `_TOTP_SECRET`, `_OAUTH_CLIENT_ID`, `_OAUTH_CLIENT_SECRET` |
| `slack`   | a workspace, a channel, DAM's app from `etc/slack/app-manifest.yaml`, a test person (`sandbox/slack.md`)                                                             | `E2E_SANDBOX_SLACK_BOT_TOKEN`, `_APP_TOKEN`, `_HUMAN_TOKEN`, `_CHANNEL_ID`                                    |
| `github2` | a second test user with an authenticator code, a member of `github`'s organization with Write on its repository, its fine-grained token (`sandbox/github-second.md`) | `E2E_SANDBOX_GITHUB2_TOKEN`, `_LOGIN`, `_PASSWORD`, `_TOTP_SECRET`                                            |
| `slack2`  | a second test person in `slack`'s channel, with an app of its own (`sandbox/slack-second.md`)                                                                        | `E2E_SANDBOX_SLACK2_HUMAN_TOKEN`                                                                              |

## Operator credentials

One value a person pastes, not an account to create (`operator_credentials` in `profile.json`): the inspector's `env.sh init` seeds it as an empty line and `verify-onboarding.sh` reports whether it is set.
It is optional; `required: false`.

| Line in `work/env/credentials.env` | What the operator fills                                               | Without it                                       |
| ---------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| `E2E_LITELLM_CURVE_BENDER_TOKEN`   | a real CurveBender (LiteLLM) API key for `litellm.cb.ete.res.ibm.com` | a criterion that needs a real model is `blocked` |
