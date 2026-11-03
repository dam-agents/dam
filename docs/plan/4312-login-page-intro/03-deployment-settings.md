# 03 — Deployment settings for the page's content

**Depends on:** 02-content-sections
**Part of:** The login page tells a new visitor what DAM is — see [README](./README.md)

## Context

The page carries IBM-specific content: the docs link, the community Slack channel and the testimonials.
This slice lets each deployment set them through Helm values.
The values travel the same way `PLATFORM_ALLOW_PASSWORD` does today: Helm value → container env var → `theme.properties` `${env.…}` placeholder → `kcContext.properties`.
A changed value needs a values change and a pod roll, not a theme rebuild.

## Implementation plan

Apply `/react-ui-engineering`.

1. **`packages/keycloak-theme/vite.config.ts`.** Add environment variables next to the two the theme already has:
   - `PLATFORM_LOGIN_DOCS_URL` — default `https://ibm.biz/dam-docs`;
   - `PLATFORM_LOGIN_COMMUNITY_LABEL`, `PLATFORM_LOGIN_COMMUNITY_URL` — default `""`;
   - `PLATFORM_LOGIN_TESTIMONIALS` — a JSON array of `{ name, role, quote }`, where `quote` can contain `{brand}`; default `""`.

   Regenerate `src/kc.gen.tsx` the way the repo does (look for the keycloakify step or task; don't hand-edit it unless that's how it's maintained).

2. **`src/login/content.ts`.** Replace the constants with `readLoginContent(properties)`, which builds `LoginContent` from `kcContext.properties`:
   - an empty string hides the item;
   - the community link needs both its label and its URL;
   - testimonials are parsed with a guard: invalid JSON, or an entry without `name` or `quote`, is dropped (and logged with `console.warn`).
     It never breaks the page;
   - `initials` and `color` come from the name (a fixed palette indexed by position is fine).

   `Login.tsx` calls it once and passes the result down.

3. **Preview.** Put the prototype's testimonials (as JSON) and the community link into the `scenarios.ts` properties, so the preview still shows the full page.
   Add a scenario with the new properties empty.

4. **Helm.** In `helm/values.yaml` under `keycloak.login`, add the following, each with a `# --` comment in the file's style:
   - `docsUrl: "https://ibm.biz/dam-docs"`
   - `community: { label: "", url: "" }`
   - `testimonials: []` (a list of `{ name, role, quote }`)

   In `helm/templates/keycloak/app.yaml`, next to `PLATFORM_ALLOW_PASSWORD`, set the env vars.
   Use `toJson` for the testimonials, quoted.
   Put the IBM content (the prototype's five quotes, without photos, and `#dam-community`) in **no** chart file.
   It belongs in that deployment's own values.
   Mention this in the PR body.
   Check whether the chart has a values schema or a generated values doc (`helm-docs`, `values.schema.json`).
   If it does, update it.

5. **Docs.** In `docs/architecture/security-and-credentials.md`, the paragraph on `keycloak.login` values: add that those values also set the login page's docs link, community link and testimonials, and update its `Last verified:` date.
   Run `/doc-drift` on the branch.

## Acceptance criteria

- [ ] `mise run //packages/keycloak-theme:build`, `mise run check`, `check:format` and `check:lint` pass.
  `helm template` with the default values renders the new env vars.
- [ ] With the chart's default values, the page shows the docs link, no community link and no testimonials section.
- [ ] With values that set all three, the page shows them, and `{brand}` in a quote becomes the realm display name.
- [ ] Invalid `PLATFORM_LOGIN_TESTIMONIALS` JSON renders the page without testimonials and doesn't throw.
- [ ] No IBM testimonial or internal Slack URL is in `helm/` or in the theme's defaults (the preview's `scenarios.ts` may keep them).

## Smoke test

Run `mise run //packages/keycloak-theme:build` and `mise run check`.
Render the chart with `helm template` twice, once with the default values and once with a small values file that sets the three values, and compare the keycloak container's env (`PLATFORM_LOGIN_*`).
In the preview, switch between the full and the empty scenario.
Then `cluster:install` the branch with that values file (see the `cluster-ops` skill), open the login page and confirm the content.
Run the e2e login (`e2e:loop`, or one spec) to confirm sign-in still works.
Print a short guide so the user can repeat these steps.
