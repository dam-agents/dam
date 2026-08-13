# Styling

**Read when:** adding or changing styles, deciding between Tailwind / inline styles / CSS vars, composing conditional classes, or reviewing style code.

## Principle: follow the project, don't restate it

This reference teaches *how to make styling decisions* — not a project's specific tokens, primitives, or theme values. Those live in the codebase and change over time; the moment a rulebook copies them it starts to drift, and will eventually teach a token or recipe the code has already deleted.

So before you style anything:

- **Read the project's theme file** to learn the real tokens (colors, spacing, shadows). Never invent a token name or trust one this document happens to mention — confirm it exists in the codebase first.
- **Find the project's shared UI/primitive library** and compose from it. Don't hand-roll a control or surface that already exists there, and don't reproduce a primitive's class recipe inline.
- **Grep existing call sites** for the pattern you're about to write, and match what the codebase already does over any example shown here.

## The stack

**[HIGH] Use Tailwind for static styling**, with CSS custom properties for theme-aware values. No per-component CSS Modules, CSS-in-JS, or SCSS.

Where the theme is defined depends on the Tailwind version the project is on — a `@theme` block in the root stylesheet (Tailwind v4) or a `tailwind.config.*` file (v3). Check which the project uses before adding tokens; don't assume, and don't add a config file to a v4 project.

## Rules

### No static `style={{}}` — [CRITICAL]

Static inline styles are forbidden: they bypass theme tokens and scatter style decisions across files. Anything static is a Tailwind class. Fix on sight when editing.

### Dynamic CSS custom properties — OK — [HIGH]

When a value genuinely varies at runtime (a width percentage, a computed offset, a user-supplied color), set a CSS custom property in `style` and consume it in CSS. This is the one legitimate use of `style={{}}`.

```tsx
<div style={{ "--progress": `${percent}%` } as CSSProperties} className="progress-bar" />
```

### Conditional classes: `cn()` / `clsx` — [HIGH]

Use the project's `cn()` helper (wraps `clsx` + `tailwind-merge`) for conditional classes; don't assemble class strings with template literals. `tailwind-merge` also resolves conflicting utilities (`px-4 px-6` → `px-6`). Locate the existing helper in the codebase rather than redefining it.

### Variants via `cva` when repeated — [MODERATE]

When a component has 3+ distinct style variants, define them with `class-variance-authority` rather than ad-hoc ternaries. For two variants with no composition, a `cn()` call is fine.

### Reuse an existing component before styling new markup — [HIGH]

Before you hand-roll and style a new element, check whether the UI library already has a component for that **intention**. If one exists, use it. A bespoke `<div>`/`<button>` carrying its own classes to do what a primitive already does is drift by construction: it looks almost right, diverges from the primitive on states, tokens, and a11y, and multiplies the surfaces a future change has to touch. Selecting a card, toggling a disclosure, laying out a form field — these are solved in the primitive library; re-deriving their classes inline is exactly how variants of the "same" component pull apart.

Custom-styled markup is justified **only** when one of these holds — and if it isn't obvious which, say so:

- it's **layout / structure** — flex and grid containers, spacing, positioning: the connective tissue *between* components, which primitives don't own; or
- **no existing component matches the intention**, and what you need is genuinely one-off or specific enough that it isn't worth a shared primitive.

When you build something new that *isn't* a one-off, flag it for promotion to the primitive library (see `references/project-structure.md`) rather than leaving a styled one-off buried in a feature file.

### One hover treatment for clickable surfaces — [MODERATE]

Give clickable cards and surfaces a single, consistent hover affordance — a background-tint change, following whatever the primitive library already uses. Avoid an elevation shadow as the hover cue: in dark mode a surface sits on a near-identical background, so a shadow reads as no feedback at all. Prefer the primitive's built-in hover over inventing your own.

### Accent / brand color is config, not a literal — [HIGH]

Never hardcode the brand/accent color as a hex value. If the project sources it at runtime (e.g. fetched and applied as a CSS variable on the document root), that runtime value overrides the stylesheet's default — so "changing the accent" means changing the config/source it comes from, **not** editing a hex in a component or the stylesheet default (which silently renders nothing). Reference the accent through its theme token/utility and let the runtime layer supply the value.

### Arbitrary values sparingly — [MODERATE]

`bg-[#fff]` / `w-[317px]` escape hatches are OK for genuinely one-off values. If the same magic number appears 3+ times, extract a theme token instead.

### Dark mode — [MODERATE]

Follow the project's dark-mode mechanism (typically a class on the root element plus Tailwind's `dark:` variant). If a token already differs between light and dark, consume the token — you don't need a `dark:` override layered on top of it.

## Tooling caveat

**`git grep -E` here does not support `\b`.** A word-boundary pattern matches nothing and reads as "already clean" — which is exactly how a token sweep can look finished when it never started. Use explicit alternatives (surrounding characters, `-w`, or `rg`) when checking whether a token or class is still in use.

## Anti-patterns

- **Static `style={{}}`** for values that could be a class.
- **Template-literal class strings** instead of `cn()`.
- **Hand-rolling a control or surface** the primitive library already provides.
- **A hardcoded hex** for a color that has a theme token — especially the accent.
- **Copying token names, primitive props, or theme values into this skill** — point at the codebase instead.
- **Arbitrary-value spam** (`bg-[#a1b2c3] text-[13px] leading-[1.23]`) repeated across components — extract a token.
- **`!important`** — nearly always a Tailwind specificity misunderstanding; `tailwind-merge` solves the common case.
