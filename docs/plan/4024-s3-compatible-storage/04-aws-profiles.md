# 04 — AWS profiles on the agent

**Depends on:** 02-sigv4-connection
**Part of:** S3-compatible object storage — see [README](./README.md)

## Context

This slice gives a granted agent ready-to-use S3 config: one AWS profile per `sigv4`
Connection carrying only the placeholder, `AWS_PROFILE` on the preferred grant, and a skill
that explains it. It also fixes an existing bug that blocks this: `ini` files with the
`key-targeted` merge break on the second apply.

## Implementation plan

Apply **/typescript-engineering** (api-server-api, api-server, agent-runtime).

1. **ini parser.** `packages/agent-runtime/src/modules/runtime-channel/infrastructure/file-codec.ts`:
   `parseFile("ini")` returns the raw string (:14-16), and `mergeKeyTargeted`
   (`file-ops.ts:140-162`) then spreads that string into an object, so an existing file
   turns into keys like `0=[`. Parse ini into the same shape `serializeIni` (:35) writes
   (top-level keys, one level of `[section]`), and keep `"text"` returning the raw string.
   `.gitconfig` uses `section-marker` (`gitconfig-contribution.ts:14-18`), not key-targeted,
   so it is unaffected; confirm by reading `mergeSectionMarker`. The section names AWS uses
   (`profile foo`) contain a space, which must round-trip.
2. **Addressing.** `packages/api-server-api/src/modules/connections/egress-addressing.ts`:
   `applyConnectionEgressAddressing` (:142) returns early unless the Connection has an
   `egress-inject` (:146). Treat `egress-sign` the same, so the placeholder in the file
   contributions becomes `platform:conn:<id>`. Check the other `egress-inject` filters in that
   file (:30, :241) and `injectionClaims` (:235): `sigv4` claims are always addressed, so they
   must never count as an unaddressable rival (`unaddressableRivalHost` :263) and two S3
   Connections on one host stay grantable together. Keep the UI mirror
   (`packages/ui/src/modules/connections/lib/grant-rivals.ts:14`) consistent.
3. **Profiles.** Next to `github-accounts.ts` in
   `packages/api-server-api/src/modules/connections/`, add an AWS profiles composer, called
   from `readGrantedContributions` in
   `packages/api-server/src/modules/runtime-delivery/services/state-builder.ts` (:118, after
   `composeGitHubAccounts` :164). For each granted `sigv4` Connection:
   - a `file` fragment for `$HOME/.aws/credentials` (`ini`, `key-targeted`): section
     `<profile>` with `aws_access_key_id = platform:conn:<id>` and a dummy
     `aws_secret_access_key`;
   - a `file` fragment for `$HOME/.aws/config` (`ini`, `key-targeted`): section
     `profile <profile>` with `endpoint_url`, `region`, `s3 =` nested
     `addressing_style = path` (check how botocore expects the nested `s3` block in the
     config file and whether `serializeIni` can express it; if not, use the flat
     `s3 =\n  addressing_style = path` form via a dedicated value), and
     `request_checksum_calculation = when_required`,
     `response_checksum_validation = when_required`;
   - one `env` `AWS_PROFILE` = the profile of the preferred grant, else the earliest grant
     (same rule and ordering as `githubAccountGroups` :67; preferred comes from
     `getAgentConnections`). Env is first-wins (`env-plugin.ts:39`), so emit exactly one.
   Do not emit `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` or `AWS_ENDPOINT_URL`: they
   override profiles.
   Preferred grant: check whether `setPreferredConnection` (`connections-service.ts:789`)
   groups siblings by GitHub host only. Make it group `sigv4` grants together (one preferred
   among an agent's S3 Connections) and surface the preferred toggle for them in the agent's
   connections panel.
4. **Profile names.** Derive from the Connection name: lower-case, keep `[a-z0-9-_]`, collapse
   anything else to `-`, trim. If two granted Connections slug to the same name, suffix the
   later grant with a short form of its id. Never `default` (reserved for the user's own
   profile). The kubeconfig path uses the name too (`kubernetes-contributions.ts:49-50`), so
   follow its precedent where it fits.
5. **Skill.** `packages/agents/base/rootfs/app/working-dir/.agents/skills/platform-s3/SKILL.md`
   (siblings: `platform-github`, `platform-artifacts`). Content: which profiles exist
   (`grep '^\[' ~/.aws/credentials`), switching with `--profile` / `AWS_PROFILE`, installing a
   client on demand (`uv tool install awscli` gives aws-cli v1; `uv pip install boto3`), that
   the keys shown are placeholders and the gateway signs, what the STREAMING refusal means and
   that the profile already sets the fix, and the limits (no presigned URLs, rclone and
   minio-go need their own config). Then `mise run skills:manifest:generate` and register it
   in `PLATFORM_SKILLS` (`packages/api-server-api/src/modules/skills/platform-skills.ts`).
   Follow `/mattpocock-skills:writing-for-agents` for the skill text.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass (incl. `check:skill-manifest`).
- [ ] With one S3 Connection granted, the agent has both files with one profile each and
      `AWS_PROFILE` set to it. No `AWS_*` key env.
- [ ] Granting a second S3 Connection adds a second profile and leaves the first file
      sections intact (the ini fix); revoking one removes only its sections.
- [ ] Marking the second grant preferred switches `AWS_PROFILE` on the next state push.
- [ ] The two S3 Connections on the same endpoint are grantable together (no rival refusal).

## Smoke test

`mise run check` and `mise run test`. Then on the local cluster, with the slice 02 Connection
(and a second one on the same endpoint, which can use the same keys) granted to one agent:
`cat ~/.aws/credentials ~/.aws/config`, `echo $AWS_PROFILE`, and with slice 03 in place
`uv tool install awscli && aws s3 ls s3://<bucket>` and
`aws --profile <other> s3 ls s3://<bucket>`. Mark the other grant preferred in the agent's
connections panel and check `AWS_PROFILE` follows.
