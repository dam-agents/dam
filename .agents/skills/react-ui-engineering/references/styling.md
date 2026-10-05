# Styling

**Read when:** adding or changing styles, choosing between Tailwind, inline styles and CSS vars, composing conditional classes, reviewing style code.

## Follow the project, don't restate it

This reference teaches how to decide, not the project's tokens, primitives or theme values: those change, and a copy here would drift until it teaches something the code deleted. Before styling:

- **Read the theme file** for the real tokens (colors, spacing, shadows). Never invent a token or trust one named here without confirming it exists.
- **Compose from the shared UI/primitive library.** Don't hand-roll a control or surface it provides, or reproduce a primitive's class recipe inline.
- **Grep existing call sites** for the pattern and match the codebase over any example here.

## The stack

**[HIGH] Tailwind for static styling**, CSS custom properties for theme-aware values. No per-component CSS Modules, CSS-in-JS or SCSS. The theme lives in a `@theme` block in the root stylesheet (Tailwind v4) or in `tailwind.config.*` (v3); check which before adding tokens, and never add a config file to a v4 project.

## Rules

**[CRITICAL] No static `style={{}}`.** It bypasses theme tokens and scatters style decisions; anything static is a class. Fix on sight.

**[HIGH] Dynamic values via CSS custom properties**: the one legitimate `style={{}}`, for values that truly vary at runtime (width %, computed offset, user-supplied color), consumed in CSS:

```tsx
<div style={{ "--progress": `${percent}%` } as CSSProperties} className="progress-bar" />
```

**[HIGH] Conditional classes through the project's `cn()`** (`clsx` + `tailwind-merge`, which also resolves conflicts: `px-4 px-6` → `px-6`), never template-literal class strings. Find the existing helper; don't redefine it.

**[MODERATE] `cva` (`class-variance-authority`) for 3+ variants**; two uncomposed variants are fine with `cn()`.

**[HIGH] Reuse an existing component before styling new markup.** If the primitive library has a component for the intention, use it. A bespoke `<div>`/`<button>` doing a primitive's job looks almost right, drifts on states, tokens and a11y, and multiplies the surfaces a future change must touch; selecting a card, toggling a disclosure and laying out a form field are already solved there. Custom-styled markup is justified only for **layout/structure** (flex/grid containers, spacing, positioning between components) or when **no component matches the intention** and the need is one-off; if it isn't obvious which, say so. Something new that isn't one-off gets flagged for promotion to the primitive library (`references/project-structure.md`).

**[MODERATE] One hover treatment for clickable surfaces**: a background-tint change, as the primitives already do (prefer their built-in hover). No elevation shadow as the hover cue; in dark mode a surface sits on a near-identical background and the shadow reads as no feedback.

**[HIGH] The accent/brand color is config, not a literal.** Never hardcode it as hex. When the project applies it at runtime (e.g. fetched and set as a CSS variable on the root), that value overrides the stylesheet default, so changing the accent means changing its source; editing a hex in a component or the stylesheet default silently does nothing. Reference it through its theme token/utility.

**[MODERATE] Arbitrary values sparingly.** `bg-[#fff]` / `w-[317px]` are fine for genuine one-offs; a magic value repeated 3+ times becomes a theme token.

**[MODERATE] Dark mode** follows the project's mechanism (usually a root class plus `dark:`). A token that already differs between themes needs no `dark:` override on top.

## Tooling caveat

`git grep -E` here doesn't support `\b`: a word-boundary pattern matches nothing and a token sweep reads as clean when it never ran. Use explicit surrounding characters, `-w`, or `rg`.

## Anti-patterns

- Static `style={{}}` for a value that could be a class.
- Template-literal class strings instead of `cn()`.
- Hand-rolling a control or surface the primitive library provides.
- A hardcoded hex for a color with a theme token, especially the accent.
- Copying token names, primitive props or theme values into this skill.
- Arbitrary-value spam (`bg-[#a1b2c3] text-[13px] leading-[1.23]`) across components → token.
- `!important`: nearly always a Tailwind specificity misunderstanding; `tailwind-merge` covers the common case.
