# 02 — Content sections and bottom sign-in

**Depends on:** 01-first-screen-and-preview
**Part of:** The login page tells a new visitor what DAM is — see [README](./README.md)

## Context

This slice fills `#info-bands` with the prototype's sections, in its order: capabilities, channels, testimonials, sandbox, DevOps, and the access section with the second sign-in form and the character widget.
The code is copied from the prototype and trimmed to what the page renders.
Testimonials have no photos.
The links and testimonials that 03 makes configurable come from one defaults module for now, so 03 only changes where those values come from.

## Implementation plan

Apply `/react-ui-engineering`.
Read prototype files with `git show origin/design/login-page:packages/keycloak-theme/<path>`.

1. **Defaults module.** Create `src/login/content.ts` holding the content that 03 moves to settings:
   - `docsUrl` (`https://ibm.biz/dam-docs`, the URL on `main`);
   - `community` (`{ label: "#dam-community", url: <the prototype's Slack archive URL> }`);
   - `testimonials` (`{ name, role, quote, initials, color }[]`, from the prototype's `testimonials()`).

   Keep the `${brandName}` substitution in quotes as a `{brand}` placeholder that the testimonials section replaces.
   That way 03's settings can use the same placeholder.
   Export one `LoginContent` type, and pass a `content: LoginContent` prop down from `Login.tsx`.
   Sections don't import the module.

2. **Sections.** Split the prototype's `src/login/components/info-bands.tsx` into one file per section under `src/login/components/sections/`, plus one shared file for `SectionLabel`, `SectionTitle`, `CARD`, `ACCENT` and the like.
   Copy `BandCapabilities` (with the scenes it renders), `BandChannels`, `BandTestimonials` (with `TestimonialCard` and the carousel), `BandSandbox`, `BandDevOps` and `BandAccess`, plus `slack-team-illustration.tsx`.
   **Do not copy** `BandIntegrations`, the `Mini*` integration logos, `DottedCircle`, or any scene that no copied section renders.
   Check each helper with a search before dropping it.

3. **Testimonials without photos.** Remove the five `../assets/testimonials/*` imports and the `photo` field.
   `TestimonialCard` always shows the initials avatar.
   Hide the section when `content.testimonials` is empty.

4. **Links.** The access section and the shared-artifact branch's links read `content.docsUrl` and `content.community`, and each link is hidden when its value is empty.
   Make the community channel name a link (the prototype's access section has it as plain text).
   Remove the `LOGIN_DOCS_URL` constants.

5. **Character widget.** Copy only `InteractiveCharacterWidget` from `animated-characters.tsx`, with the bodies, eyes, hooks and style injection it uses, into `src/login/components/character-widget.tsx`.
   Leave out the other variants, `CharacterPlayground`, `StackedCharacters`, `SlackWindowCompanions` and the rest.
   Check that it respects `prefers-reduced-motion`; add that if it's missing.

6. **Leave out unused files.** Don't copy `aurora-backdrop.tsx` or `faq-accordion.tsx` unless a copied section renders them.

7. **`Login.tsx`.** Render the sections inside `#info-bands`.
   `BandAccess` gets a second `LoginForm` with `formId="kc-form-login-bottom"`, `autoFocusInput={false}` and `dividerBgClass="bg-muted/30"`.
   The brand comes from `realm.displayName || BRAND_FALLBACK`.

8. **Dark mode.** Every section reads well in dark mode: use theme tokens instead of hard-coded light colours, and add `dark:` variants for the illustrations' fixed colours.

## Acceptance criteria

- [ ] `mise run //packages/keycloak-theme:build`, `mise run check`, `check:format` and `check:lint` pass.
- [ ] In the preview, the page below the first screen shows the six sections in the prototype's order, in light and in dark mode, and at a phone width with no horizontal scroll.
- [ ] No import of `../assets/testimonials`.
  Each testimonial shows initials.
- [ ] `rg 'BandIntegrations|CharacterPlayground|HeroHuddle' packages/keycloak-theme/src` finds nothing.
- [ ] The bottom form's inputs have the ids `kc-form-login-bottom-username` and `kc-form-login-bottom-password`.
  The top form's inputs keep `username` and `password`.
- [ ] Sections get their content only through the `content` prop.

## Smoke test

Run `mise run //packages/keycloak-theme:build` and `mise run check`.
Run `mise run //packages/keycloak-theme:preview`, click "Learn more" in agent-browser, and scroll to the bottom.
Take screenshots of each section, light and dark, at desktop and phone width.
Run `mise run //packages/keycloak-theme:run` and sign in as `testuser` / `password123` from the **bottom** form, then from the top form.
Print a short guide so the user can repeat these steps.
