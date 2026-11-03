# 04 — Testimonials in the database

**Depends on:** 03-deployment-settings
**Part of:** The login page tells a new visitor what DAM is — see [README](./README.md)

## Context

In 03 the testimonials reach the login page as a Helm value, so changing one means a chart upgrade and a Keycloak restart, and a photo cannot be added at all.
This slice moves them into the platform's database, one row per testimonial, and the login page fetches them from a public api-server endpoint each time it loads.
Photos reuse the agent avatar image store: an upload is cropped to a 512 px PNG, stored under its hash and served without sign-in.
The docs link and the community link stay Helm values.
Editing has a tRPC surface here; the Settings card and the CLI come in 05.

## Implementation plan

Apply `/typescript-engineering` for the server and `/react-ui-engineering` for the theme.

1. **Table.** In `packages/db/src/schema.ts` add `loginTestimonials` (`login_testimonials`): `id` uuid primary key, `position` integer not null, `name` text not null, `role` text not null default `''`, `quote` text not null, `photoId` text nullable (an `avatar_images.id`), `updatedAt` timestamptz not null default now, `updatedBy` text not null.
   Run `mise run //packages/db:generate`, add a top comment to the generated SQL saying why, and commit the journal and snapshot with it (`packages/db/AGENTS.md`).
2. **Module.** New `packages/api-server/src/modules/login-testimonials/` in the three-layer shape of `spend` or `budgets`: a repository (list ordered by `position`; replace the whole list in one transaction), a service, and `compose.ts`/`index.ts` wired in `bootstrap.ts`.
   Saving replaces the full ordered list: the operator UI and CLI always send the whole list, so there is no partial reorder API and no position conflicts.
   Validate on save: at most 20 testimonials; `name` 1–80 chars, `role` 0–120, `quote` 1–600; `photoId` either null or an id that exists in `avatar_images`.
3. **tRPC.** In `packages/api-server-api/src/modules/login-testimonials/` add `schemas.ts` and `router.ts`: `list` and `save` (the whole ordered list), both `operatorProcedure`, registered in the app router like `spend`.
4. **Photos.** Operators upload through the existing `POST /api/avatars` (it needs `agents:manage`, which every interactive user holds) and keep the returned `image:<id>`'s id as `photoId`.
   Add the testimonials' `photoId`s to the keep list of `sweepAvatarImages` (`packages/api-server/src/modules/agents/infrastructure/avatar-image-routes.ts`, and where `bootstrap.ts` builds that list), so the hourly sweep never deletes a testimonial's photo.
5. **Public endpoint.** `GET /api/public/login-testimonials` in `apps/api-server/routes/`, mounted under the existing `/api/public/*` public prefix: `{ testimonials: [{ name, role, quote, photoUrl | null }] }` in order, `photoUrl` the absolute URL of `/api/public/avatars/<id>`.
   It answers CORS for the Keycloak origin only (`platform.url.keycloak`, passed to the api-server as a new env var from `helm/templates/apiserver/app.yaml`), with `Cache-Control: public, max-age=60`.
6. **Helm and theme properties.** Remove `keycloak.login.testimonials` and `PLATFORM_LOGIN_TESTIMONIALS` (values, Keycloak env, `vite.config.ts`, `kc.gen.tsx` via its generator, the oauth-grant test fixture).
   Add `PLATFORM_API_URL` to the theme, set from the platform's own URL helper in `helm/templates/keycloak/app.yaml`.
7. **Login page.** In `packages/keycloak-theme/src/login/content.ts` replace `parseTestimonials` of the property with a `useTestimonials(apiUrl)` hook that fetches the endpoint once, with a 5 s timeout.
   While loading, failed, or empty, the testimonials section is not rendered; sign-in never waits for it.
   `TestimonialCard` shows the photo when `photoUrl` is set (`alt=""`, it sits next to the name) and the initials otherwise.
   The preview's scenarios serve sample data from a stub of the endpoint (a vite `server.proxy` or a fetch stub in `preview.tsx`), with the real testimonials as sample content, plus a scenario where the call fails.
8. **Docs.** `docs/architecture/security-and-credentials.md`: the testimonials sentence from 03 now says they come from the platform's database, through a public endpoint only Keycloak's origin may call, and that only operators change them.
   `docs/architecture/agent-avatars.md`: the sweep also keeps the testimonials' photos.
   Run `/doc-drift`.

## Acceptance criteria

- [ ] `mise run //packages/db:check:generated`, `mise run check` (with `check:format`, `check:lint`, `check:comment-types`, `//docs:check`) and `mise run //packages/api-server:test` pass.
- [ ] A non-operator calling `loginTestimonials.save` or `list` gets `FORBIDDEN`; an operator's save replaces the list and its order.
- [ ] Saving with an unknown `photoId`, or past a limit, is refused with a message naming the field.
- [ ] `GET /api/public/login-testimonials` answers without sign-in, sends `Access-Control-Allow-Origin` for the Keycloak origin and none for another origin.
- [ ] The login page shows the saved testimonials, with photos where set, on the next load after a save, with no redeploy or restart.
- [ ] With the api-server unreachable, the login page renders without the testimonials section and sign-in works.
- [ ] A testimonial's photo survives the hourly avatar sweep.
- [ ] No `testimonials` value remains in `helm/values.yaml`.

## Smoke test

Run the checks above.
`cluster:build -- api-server keycloak` and `cluster:helm -- --set=virtualization.enabled=true`.
As `dev` (make it an operator by adding it to the `operators` group in Keycloak's admin console), call `loginTestimonials.save` with two entries through the UI's tRPC endpoint (`curl` with the session cookie, or the browser console), one with a `photoId` from `POST /api/avatars`.
Reload the login page: both show, in order, one with its photo.
Save an empty list: the section is gone on the next load.
`curl -H 'Origin: http://evil.example' .../api/public/login-testimonials` gets no CORS header.
Print a short guide so the user can repeat it.
