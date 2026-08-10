# Platform UI Design System

Complete reference for building UI features in the Platform frontend. Read this document top-to-bottom before implementing any UI work: the taste rules come first because they override any technical default.

---

## Design Philosophy & Taste

These are the durable judgment calls that make a screen read as native DAM. Violating any of these — even while using the correct components — produces work that looks wrong.

### Cardinal Rules

1. **Buttons are BLACK, never blue.** The default Button (`--primary`) is black with white text. Blue (`--c-accent`) is exclusively for links, active nav highlights, and focus rings. This is the single most common mistake.

2. **Color has fixed meaning — never swap it:**
   - Green = success / running
   - Amber = warning / needs attention
   - Red = error / destructive (deletes data, can't be undone)
   - Purple = templates / skills
   - Blue = interactive accent (links, focus, active nav) — never buttons

3. **Destructive vs. warning is a real distinction:**
   - **Destructive** (deletes data, irreversible): red icon + red confirm button, verb "Remove" / "Delete". Uses `kind: "destructive"` in confirm-dialog.
   - **Warning** (risky but reversible, nothing deleted): amber icon + black confirm button. Uses `kind: "default"` in confirm-dialog.
   - Never dress a warning in red.

4. **Mono for machine text.** Repo names, URLs, IDs, file paths, and any metric/number use IBM Plex Mono (`font-mono`) with tabular figures. Body/UI text is IBM Plex Sans.

5. **Simple and elegant wins — restraint is the whole aesthetic.** Solve the problem with the smallest clean change: a labelled field, a chip, a pill, a short helper line. Avoid meters, trays, steppers, side panels. If a control needs a legend to read, it's too complex.

6. **Menus overlay, never reflow.** An open dropdown/overflow menu is `position: absolute` over the content (raised z-index + shadow). Siblings never jump. Helper text goes in a `<p>` below the control, not inside the menu.

7. **Empty states are required, not optional.** Anything that can be unpopulated gets a genuine empty state — guidance text + the primary "add/connect" action — not a blank area.

8. **Chat-guided over form-heavy.** DAM guides setup through chat with a light scaffold, not long wizards. Prefer a conversation with chips + inline cards.

9. **Show the agent doing the work.** For agent flows, depict spawning → working → reporting as visible steps, not a finished artifact that teleports in.

### Language & Terminology

Always use terms from `docs/ubiquitous-language.md`:
- "Sandbox" not "Agent" in the UI (the UI surface is the sandbox; the agent is the runtime inside it)
- "Share / who can access" not "MCP server"
- Never invent config knobs, thresholds, or model requirements that don't exist

### Context Rule

Every new screen or component must be designed **inside the real shell** — icon rail + sub-nav + header + surrounding fields. A standalone card on a blank page is the #1 failure mode. If it wouldn't sit comfortably next to the real screens, it's wrong.

### Continuity Rule — Match the Existing UI Exactly

New UI must look **identical** to the existing DAM screens — not "inspired by" them, not a reimagination of them. It must use the same tokens, same component shapes, same spacing, same border treatments, same font sizes, same colors at the same values. If the existing UI has `border-radius: 8px` cards with `1px solid #dde1e6` borders, your new card must too — not `6px` with a slightly different gray.

Concretely:
- **Read the existing source first.** Before building any new view, look at what's already rendered in the app. The `.tsx` files in `packages/ui/src/` are the source of truth for how components actually look.
- **Reuse existing components.** Use `<Button>`, `<Badge>`, `<DropdownMenu>`, `<PageHeader>`, `<PageEmptyState>`, `<Select>`, etc. as they already exist. Don't rewrite their styling or create parallel versions.
- **Don't approximate token values.** If you need the background color, read it from `App.css` or the existing component. Don't guess a close value from memory.
- **Prototypes must be pixel-faithful.** Self-contained HTML previews (when the backend isn't available) must extract the exact CSS from `docs/design/design-system-visual.html` and the actual component source — same hex codes, same `rem`/`px` values, same shadows, same font weights. A prototype that "sorta looks like" the app is a failed prototype.
- **When in doubt, screenshot the real app.** If you can't run the dev server, reference existing screenshots or the visual HTML reference. The goal is that a user looking at your new screen can't tell where the old UI ends and the new UI begins.

---

## Stack & File Map

| Concern | Technology | Key file(s) |
|---------|-----------|-------------|
| Framework | React 19 + Vite | `packages/ui/src/main.tsx` |
| Styling | Tailwind CSS v4 (CSS-first config) | `packages/ui/src/App.css` |
| Component variants | class-variance-authority (CVA) | Each `components/ui/*.tsx` |
| Primitives | Radix UI | `@radix-ui/react-*` |
| Component generator | shadcn/ui (new-york style) | `packages/ui/components.json` |
| Icons | @carbon/icons-react + lucide-react | — |
| State (client) | Zustand | `packages/ui/src/store.ts` |
| State (server) | TanStack Query + tRPC | `modules/*/api/queries.ts` |
| Forms | react-hook-form + zod v4 | `modules/*/hooks/use-*-form.ts` |
| Fonts | IBM Plex Sans (300–700), IBM Plex Mono (400–600) | `index.html` `<link>` |

**Import alias:** `@/` resolves to `packages/ui/src/`

**Class utility:** Always use `cn()` from `@/lib/utils` for className composition:

```ts
import { cn } from "@/lib/utils";
// cn = clsx + tailwind-merge
```

**Branding rule:** Never hardcode brand name. Use `getBrand().name` from `@/brand`.

**Where the real implementations live:** When a component shape matters, read the source directly — this document captures taste and values that don't drift, but exact padding/variant classes belong to the `.tsx` files.

---

## Design Tokens

All tokens are defined in `packages/ui/src/App.css` as CSS custom properties in `:root` / `.dark`, mapped to Tailwind via the `@theme {}` block.

### Color Palette

| Token | Tailwind utility | Light | Dark |
|-------|-----------------|-------|------|
| `--c-bg` | `bg-bg` | `#fafaf9` | `#0c0a09` |
| `--c-surface` | `bg-surface` | `#ffffff` | `#161616` |
| `--c-surface-raised` | `bg-surface-raised` | `#f5f5f4` | `#262626` |
| `--c-text` | `text-text` | `#121619` | `#fafaf9` |
| `--c-text-secondary` | `text-text-secondary` | `#57534e` | `#d6d3d1` |
| `--c-text-muted` | `text-text-muted` | `#a8a29e` | `#78716c` |
| `--c-accent` | `text-accent`, `bg-accent` | `#1d6be1` | `#3c92fd` |
| `--c-accent-hover` | `bg-accent-hover` | `#1556b8` | `#2f88fd` |
| `--c-accent-light` | `bg-accent-light` | `#eaf2fe` | `#0f1f3a` |
| `--c-accent-glow` | `bg-accent-glow` | `rgba(29,107,225,0.15)` | `rgba(60,146,253,0.2)` |
| `--c-success` | `text-success`, `bg-success` | `#24a148` | `#34d399` |
| `--c-success-light` | `bg-success-light` | `#defbe6` | `#0f2a1f` |
| `--c-warning` | `text-warning`, `bg-warning` | `#ff832b` | `#fbbf24` |
| `--c-warning-light` | `bg-warning-light` | `#fffbeb` | `#3a2a10` |
| `--c-danger` | `text-danger`, `bg-danger` | `#dc2626` | `#f87171` |
| `--c-danger-light` | `bg-danger-light` | `#fef2f2` | `#3a1515` |
| `--c-info` | `text-info`, `bg-info` | `#000000` | `#60a5fa` |
| `--c-info-light` | `bg-info-light` | `#f2f4f8` | `#0f1f3a` |
| `--c-template` | `text-template` | `#7c3aed` | `#a78bfa` |
| `--c-template-light` | `bg-template-light` | `#f5f3ff` | `#1f1438` |
| `--c-callout-bg` | `bg-callout` | `#edf5ff4d` | `#0f1f3a` |
| `--c-callout-border` | `border-callout-border` | `#a6c8ff` | `#3c92fd` |

### Color Semantics (fixed — never reassign)

| Color | Meaning | Use for |
|-------|---------|---------|
| Green (`success`) | Success / running / healthy | Running badges, success toasts, connected states |
| Amber (`warning`) | Warning / needs attention | Starting states, risky-but-reversible confirms, degraded |
| Red (`danger`) | Error / destructive / broken | Error badges, delete confirms, failed states |
| Purple (`template`) | Templates / skills | Template badges, skill indicators |
| Blue (`accent`) | Interactive accent only | Links, active nav, focus rings, selections — NEVER buttons |
| Black (`primary`) | Primary actions | Buttons, strong text, primary affordances |

### shadcn Token Layer

These tokens are consumed by shadcn/ui primitives (Button, Card, etc.):

| Token | Light | Dark | Used by |
|-------|-------|------|---------|
| `--background` | `#ffffff` | `#161616` | `bg-background` |
| `--foreground` | `#121619` | `#fafaf9` | `text-foreground` |
| `--primary` | `#000000` | `#ffffff` | Button default, text-primary |
| `--primary-foreground` | `#ffffff` | `#161616` | Button default text |
| `--secondary` | `#f2f4f8` | `#262626` | Button secondary bg |
| `--muted` | `#f2f4f8` | `#262626` | `bg-muted`, hover states |
| `--muted-foreground` | `#4d5358` | `#a8a29e` | `text-muted-foreground` |
| `--destructive` | `#dc2626` | `#f87171` | Destructive button |
| `--border-ui` | `#dde1e6` | `#393939` | Default border |
| `--input` | `#dde1e6` | `#393939` | Input border |
| `--ring` | `#000000` | `#ffffff` | Focus ring |
| `--card` | `#ffffff` | `#161616` | Card background |

### Border System

Three tiers — use the semantic utility, never raw colors:

| Utility | Token | Purpose |
|---------|-------|---------|
| `border-border` | `--border-ui` | Default border (cards, inputs, dividers) |
| `border-border-light` | `--c-border-light` | Subtle separators (table rows, section dividers) |
| `border-border-hairline` | `--c-border-hairline` | Barely-visible lines (intra-card separators) |

### Radius Scale

| Utility | Value | Use case |
|---------|-------|----------|
| `rounded-sm` | 4px | Small chips, inline badges |
| `rounded-md` | 6px | Buttons, inputs, badges |
| `rounded-lg` | 8px | Cards, callouts |
| `rounded-xl` | 12px | Modals, code blocks, popovers |

Base `--radius` = `0.5rem` (8px).

### Z-Index Ladder

Always use named utilities — never raw `z-[N]`:

| Utility | Value | Purpose |
|---------|-------|---------|
| `z-content` | 10 | Main page content |
| `z-raised` | 20 | Floating elements within content |
| `z-nav` | 30 | Icon rail, mobile bottom bar |
| `z-overlay` | 40 | Modals, backdrop |
| `z-banner` | 50 | Connection banners |
| `z-popover` | 60 | Dropdown menus, popovers |
| `z-tooltip` | 70 | Tooltips |
| `z-toast` | 80 | Toast notifications |

### Spacing Conventions

No custom scale — uses Tailwind defaults. Recurring patterns:

| Context | Spacing |
|---------|---------|
| Between card-list items | `gap-3` |
| Between inline elements | `gap-2` |
| Card internal padding | `p-4` or `p-6` |
| Page section vertical | `py-6 md:py-10` |
| Page horizontal padding | `px-4 md:px-[5%]` |
| Form field vertical gap | `gap-2` (label to control) |
| Button group gap | `gap-2` or `gap-3` |
| Modal footer gap | `gap-3` |

---

## Typography

| Role | Classes | Result |
|------|---------|--------|
| Page title | `text-[24px] font-semibold tracking-[-0.65px] md:text-[28px]` | 24/28px semibold |
| Section heading | `text-[16px] font-semibold` | 16px semibold |
| Body (default) | (none — inherits base) | 15px regular |
| Body (smaller) | `text-sm` | 14px |
| Label (uppercase) | `text-[11px] font-medium uppercase tracking-[1.65px] text-muted-foreground` | 11px caps |
| Hint text | `text-[12px] text-muted-foreground` | 12px muted |
| Badge text | `text-[12px] tracking-[0.338px]` | 12px |
| Code / machine text | `font-mono` | IBM Plex Mono |

**Font families:**
- Sans (body/UI): `"IBM Plex Sans", system-ui, -apple-system, sans-serif`
- Mono (machine text): `"IBM Plex Mono", ui-monospace, monospace`

**Base:** 15px, line-height 1.55, antialiased.

**Minimum text size:** 14px (`text-sm`) is the floor for readable text. 12px only for badges, labels, and hints.

**When to use mono:** Repo names, URLs, IDs, file paths, API keys, metric values, port numbers — anything a machine generated or a user would copy verbatim.

---

## Icons

| Library | Import | Use for |
|---------|--------|---------|
| `@carbon/icons-react` | `import { Add } from "@carbon/icons-react"` | Navigation, system chrome, structural icons |
| `lucide-react` | `import { Download } from "lucide-react"` | Content/action icons (copy, share, download) |

**Decision rule:** If Carbon has the icon, prefer Carbon. Use Lucide for action verbs that Carbon lacks.

**Sizing:**

| Context | Size |
|---------|------|
| Nav rail icons | `size={20}` |
| Inline / button icons | `size={16}` |
| Extra-small contexts | `size={14}` |

---

## Component API Reference

### Button

**File:** `packages/ui/src/components/ui/button.tsx`

```ts
interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "xs" | "lg" | "icon" | "icon-sm" | "icon-xs";
  tone?: "default" | "danger";
  asChild?: boolean;
}
```

**Variants:**

| Variant | Appearance | When to use |
|---------|-----------|-------------|
| `default` | **Black** filled, white text | Primary actions (Save, Create, Confirm) |
| `destructive` | Red filled | Destructive confirm buttons in dialogs only |
| `outline` | Bordered, transparent bg | Secondary actions alongside a primary |
| `secondary` | Grey filled | Tertiary actions, less emphasis than outline |
| `ghost` | No border/bg, hover reveals | Toolbar actions, icon buttons, subtle triggers |
| `link` | Underline on hover | Inline text links styled as buttons |

**Sizes:**

| Size | Height | Use case |
|------|--------|----------|
| `default` | 40px | Primary/standard actions |
| `sm` | 36px | Secondary actions, toolbar |
| `xs` | 28px | Inline actions, compact UI |
| `lg` | 44px | Hero CTAs |
| `icon` | 40×40px | Icon-only button |
| `icon-sm` | 28×28px | Compact icon button |
| `icon-xs` | 24×24px | Tiny icon button |

**Tone (compound variants):** The `tone="danger"` axis modifies hover states for ghost/outline/link without a full variant:
- `ghost` + `danger` → red hover bg + red text
- `outline` + `danger` → red hover bg/text/border
- `link` + `danger` → red text always

**Usage:**

```tsx
import { Button } from "@/components/ui/button";
import { Add } from "@carbon/icons-react";

<Button variant="outline" size="sm"><Add size={16} /> Add item</Button>
<Button variant="ghost" tone="danger" size="icon-sm"><TrashCan size={16} /></Button>
<Button asChild><a href="/path">Navigate</a></Button>
```

---

### Badge

**File:** `packages/ui/src/components/ui/badge.tsx`

```ts
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" | "info" | "muted" | "accent" | "template";
  size?: "default" | "sm";
}
```

Renders as `<span>` (safe inside buttons/phrasing content). 11 semantic color variants map to the color system.

**Usage:**

```tsx
<Badge variant="success">Running</Badge>
<Badge variant="warning" size="sm">Starting</Badge>
```

---

### Input

**File:** `packages/ui/src/components/ui/input.tsx`

```ts
interface InputProps extends Omit<React.ComponentProps<"input">, "size"> {
  variant?: "standard" | "monospace" | "invalid";
  size?: "default" | "sm" | "xs";
}
```

| Variant | Use case |
|---------|----------|
| `standard` | Default text input |
| `monospace` | Code, URLs, API keys — anything machine-generated |
| `invalid` | Error state (red border + ring) |

| Size | Height |
|------|--------|
| `default` | 40px |
| `sm` | 32px |
| `xs` | 28px |

---

### Card

**File:** `packages/ui/src/components/ui/card.tsx`

Composition pattern with sub-components:

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Subtitle text</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
  <CardFooter>...</CardFooter>
</Card>
```

Has `data-slot="card"` for dark-mode elevation shadow (`0 2px 5px 0 rgb(255 255 255 / 0.12)`).

---

### Callout

**File:** `packages/ui/src/components/ui/callout.tsx`

```ts
interface CalloutProps extends React.ComponentProps<"div"> {
  tone?: "default" | "muted" | "info" | "warning" | "danger";
  variant?: "solid" | "dashed";
  size?: "sm" | "md";
  inset?: boolean;
}
```

The single bordered container for hints, notices, alerts, and form groups. Children own their own anatomy.

**Usage:**

```tsx
<Callout tone="info" size="md">
  <p className="text-sm">Informational message here.</p>
</Callout>
<Callout tone="default" variant="dashed" size="sm">
  Optional section content
</Callout>
```

---

### PageHeader

**File:** `packages/ui/src/components/ui/page-header.tsx`

```ts
interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  adornment?: ReactNode;  // inline badge/chip after title
  className?: string;
}
```

Container-query responsive: stacks on mobile, row layout at `@lg`. Always wrap pages with this.

```tsx
<PageHeader
  title="Knowledge Bases"
  description="Manage your vector stores and document sources."
  actions={<Button size="sm"><Add size={16} /> Create</Button>}
/>
```

---

### PageEmptyState

**File:** `packages/ui/src/components/ui/page-empty-state.tsx`

```ts
interface Props {
  title: string;
  message: ReactNode;
  actionLabel: string;
  actionIcon?: ReactNode;
  onAction: () => void;
}
```

Full-page centered empty state with fade-in animation. **Required** when a list view has zero items — never leave a page blank.

---

### EmptyStateCard

**File:** `packages/ui/src/components/ui/empty-state-card.tsx`

```ts
interface Props {
  message: string;
  actionLabel: string;
  onAction: () => void;
  actionTestId?: string;
}
```

Inline empty state card for sections within a page (not full-page). **Required** for any section that can be empty.

---

### Modal

**File:** `packages/ui/src/components/modal.tsx`

```ts
interface ModalProps {
  widthClass?: string;  // default "w-[560px]"
  children: ReactNode;
}
```

Compose with three slots:

```tsx
import { Modal, DialogHeader, DialogBody, DialogFooter } from "@/components/modal";

<Modal>
  <DialogHeader>
    <h2 className="text-lg font-semibold">Dialog Title</h2>
  </DialogHeader>
  <DialogBody>
    Content here
  </DialogBody>
  <DialogFooter>
    <Button variant="ghost" onClick={close}>Cancel</Button>
    <Button onClick={save}>Save</Button>
  </DialogFooter>
</Modal>
```

**Key behaviors:**
- Portal to `document.body` (escapes app shell stacking)
- Focus trap (Tab cycles inside panel)
- Body scroll lock (ref-counted for nested overlays)
- Does NOT close on backdrop click or Escape (protects form state)
- `aria-modal="true"`, `aria-labelledby` wired to DialogHeader
- `DialogBody` accepts `flush` prop for full-bleed content (removes horizontal padding)
- Max height: `95dvh` mobile, `85vh` desktop

---

### ConfirmDialog

Driven by Zustand store — don't render modals yourself for confirms:

```ts
import { useStore } from "@/store";

const confirm = useStore((s) => s.showConfirm);

// Destructive: red confirm button, verb "Delete"/"Remove"
const ok = await confirm({
  title: "Delete item?",
  message: "This cannot be undone.",
  kind: "destructive",
  confirmLabel: "Delete",
});

// Warning: black confirm button, amber icon, verb describes the risk
const ok = await confirm({
  title: "Switch provider?",
  message: "The sandbox will restart with the new provider.",
  kind: "default",
  confirmLabel: "Switch",
});
```

---

### DropdownMenu & ContextMenu

Both use shared styling from `packages/ui/src/components/ui/menu-styles.ts`:

```ts
const menuItemVariants = cva(/* ... */, {
  variants: {
    tone: { default: "...", danger: "..." }
  }
});
```

Menus are always `position: absolute` — they overlay content, never reflow siblings.

```tsx
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon-sm"><OverflowMenuVertical size={16} /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem>Edit</DropdownMenuItem>
    <DropdownMenuItem tone="danger">Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

In single-select lists: sort connected/active items first, then alphabetical. No divider between groups unless explicitly required.

---

### Tooltip

Radix-based, consistent across the app:

```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild><Button variant="ghost" size="icon-sm">...</Button></TooltipTrigger>
    <TooltipContent side="bottom">Helpful text</TooltipContent>
  </Tooltip>
</TooltipProvider>
```

---

### SectionLabel

**File:** `packages/ui/src/components/ui/section-label.tsx`

```ts
interface Props {
  className?: string;
  spaced?: boolean;  // adds mb-3 block
  children: ReactNode;
}
```

The uppercase micro-label. Style: `text-[11px] font-medium uppercase tracking-[1.65px] text-muted-foreground`.

```tsx
<SectionLabel spaced>Configuration</SectionLabel>
```

---

### FormField

**File:** `packages/ui/src/components/form-field.tsx`

```ts
interface Props {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  disableInset?: boolean;
  labelInset?: boolean;
  children: ReactNode;
}
```

Wraps a single form control with label + hint + error. The inset system aligns controls with labels:
- **Default (page forms):** Control outdents left by 16px (`md:-ml-4`) so its inner text aligns with the label
- **`labelInset` (modals):** Label indents right instead (no gutter to bleed into)
- **`disableInset`:** No alignment shift (legacy or nested panels)

```tsx
<FormField label="Name" hint="A unique identifier" error={errors.name?.message}>
  <Input {...register("name")} />
</FormField>
```

---

### Toast (Sonner)

```ts
import { emitToast } from "@/lib/toast";

emitToast({ kind: "success", message: "Saved successfully." });
emitToast({ kind: "error", message: "Failed to save.", ttl: 8000 });
emitToast({ kind: "info", message: "Processing...", action: { label: "Undo", onClick: undo } });
```

Kinds: `success`, `error`, `warning`, `info`. Positioned top-right.

---

### Switch

```tsx
import { Switch } from "@/components/ui/switch";

<Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable feature" />
```

---

### Select

```tsx
import { Select } from "@/components/ui/select";

<Select size="default" variant="standard" value={val} onChange={setVal}>
  <option value="a">Option A</option>
  <option value="b">Option B</option>
</Select>
```

For long lists (10+ options), use `SearchableSelect` instead.

---

## Layout Patterns

### App Shell

```
┌─────────────────────────────────────────────┐
│ ┌──────┐ ┌──────────────────────────────┐   │
│ │ Icon │ │                              │   │
│ │ Rail │ │     Main Content Area        │   │
│ │ 56px │ │     (overflow-y-auto)        │   │
│ │      │ │                              │   │
│ └──────┘ └──────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

Root: `flex h-dvh bg-background overflow-hidden`
- IconRail: `w-[56px]` sidebar (desktop), fixed bottom bar (mobile)
- Content: `relative z-content flex-1 overflow-y-auto`

### Standard Page

For list views, settings, inbox — any page inside the shell:

```tsx
<div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-6 md:py-10 pb-20 md:pb-10">
  <PageHeader title="..." />
  {/* content */}
</div>
```

`pb-20 md:pb-10` — extra bottom padding on mobile for bottom bar clearance.

### Two-Column Page (Sandbox Home)

Sticky left nav + bounded content:

```
┌─────────────────────────────────────────┐
│ max-w-[920px]                           │
│ ┌─────────┐ ┌────────────────────────┐  │
│ │ Sticky  │ │  Content               │  │
│ │ Nav     │ │  max-w-[666px]         │  │
│ │ 245px   │ │                        │  │
│ └─────────┘ └────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Chat View

Full-height, no max-width constraint, icon rail hidden on mobile:

```tsx
<div className="flex h-dvh bg-background overflow-hidden">
  <IconRail hideMobileBar />
  <div className="relative z-content flex-1 min-w-0">
    <ChatView />
  </div>
</div>
```

### Modal Layout

- Width: `w-[560px]` (default, configurable via `widthClass`)
- Max height: `max-h-[95dvh] md:max-h-[85vh]`
- Border radius: `rounded-xl`
- Backdrop: `bg-black/50 backdrop-blur-[4px]`
- Stacking: `z-overlay`

### Mobile Conventions

- Breakpoint: 768px (`md:` prefix)
- Bottom bar clearance: `pb-20 md:pb-10`
- Safe areas: `.safe-bottom` / `.safe-top` for notched devices
- Icon rail becomes fixed bottom nav on mobile
- Modal goes near-full-height: `max-h-[95dvh]`

---

## Animations

| Class | Effect | Duration | Use case |
|-------|--------|----------|----------|
| `anim-in` | Fade in + slide up 6px | 0.2s ease-out | Elements appearing (cards, rows, pages) |
| `anim-scale-in` | Scale from 95% + slide up 8px | 0.15s ease | Modals, popovers, menus |
| `anim-blink` | Opacity 0/1 | 1s step-end ∞ | Cursor blink |
| `anim-spin` | Rotate 360° | 0.7s linear ∞ | Loading spinners |
| `anim-pulse` | Opacity 1→0.35→1 | 1.4s ease ∞ | Loading states |
| `anim-slide` | translateX -100%→400% | 1s ease ∞ | Progress shimmer |
| `anim-slide-in-right` | translateX 100%→0 | 0.25s ease-out | Side panels entering |
| `working-dots` | Staggered bounce (3 dots) | 0.9s ease ∞ | AI typing indicator |

**Tailwind built-in:** Use `animate-pulse` for skeleton loading states.

---

## State Management

### Zustand (Client State)

Global store at `packages/ui/src/store.ts` composed of feature slices:

```ts
import { useStore } from "@/store";

const view = useStore((s) => s.view);
const setView = useStore((s) => s.setView);
```

Slices: `navigation`, `theme`, `dialog`, `agents`, `sessions`, `features`, `permissions`.

Theme persisted to `localStorage` key `platform-theme`. Values: `"light"`, `"dark"`, `"system"`.

### TanStack Query (Server State)

Query key factory pattern:

```ts
// modules/agents/api/queries.ts
export const agentKeys = {
  root: ["agents"] as const,
  list: () => [...agentKeys.root, "list"] as const,
  detail: (id: string) => [...agentKeys.root, id] as const,
};

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: () => api.agents.list.query(),
  });
}
```

Mutations with auto-invalidation:

```ts
export function useDeleteAgent() {
  return useMutation({
    mutationFn: (id: string) => api.agents.delete.mutate({ id }),
    meta: {
      invalidates: [agentKeys.root],
      errorToast: true,
    },
  });
}
```

### tRPC Integration

```ts
import { api } from "@/lib/api";  // typed tRPC client

const result = await api.agents.list.query();
await api.agents.create.mutate({ name: "..." });
```

---

## Module Architecture

Every feature follows this directory structure:

```
modules/<feature>/
  api/
    queries.ts      — TanStack Query hooks + key factory
    mutations.ts    — useMutation hooks with invalidation
  components/       — feature-specific UI
  hooks/            — custom hooks (form state, derived data)
  views/            — top-level page components (*-view.tsx)
  store.ts          — (optional) Zustand slice
  forms/            — (optional) form sub-components
  lib/              — (optional) pure utilities
```

**Naming conventions:**
- Views: `*-view.tsx` (e.g., `list-view.tsx`, `settings-view.tsx`)
- Files: kebab-case
- Exports: PascalCase for components, camelCase for hooks/utils
- Queries: `use<Entity>s()` for list, `use<Entity>(id)` for detail
- Mutations: `useCreate<Entity>()`, `useUpdate<Entity>()`, `useDelete<Entity>()`

**Integration checklist for new feature:**
1. Create module directory under `modules/`
2. Add route case in `packages/ui/src/app.tsx`
3. Add nav entry in `packages/ui/src/components/icon-rail.tsx` (if top-level)
4. Add navigation action in `packages/ui/src/modules/platform/store/navigation.ts`
5. Add route definition in `packages/ui/src/modules/platform/lib/routes.ts`

---

## Form Patterns

### Schema-first

```ts
// modules/<feature>/hooks/use-<feature>-schema.ts
import { z } from "zod";

export const featureSchema = z.object({
  name: z.string().min(1, "Required"),
  description: z.string().optional(),
});
export type FeatureFormData = z.infer<typeof featureSchema>;
```

### Hook-owned form

```ts
// modules/<feature>/hooks/use-<feature>-form.ts
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

export function useFeatureForm(initial?: Feature) {
  const form = useForm<FeatureFormData>({
    resolver: zodResolver(featureSchema),
    defaultValues: { name: initial?.name ?? "", ... },
  });
  return { form, status: form.formState };
}
```

### Form layout

```tsx
<SectionLabel spaced>General</SectionLabel>
<FormField label="Name" error={errors.name?.message}>
  <Input {...register("name")} />
</FormField>
<FormField label="Description" hint="Optional">
  <Textarea {...register("description")} />
</FormField>

<SectionLabel spaced>Advanced</SectionLabel>
<Callout variant="dashed" size="sm">
  <FormField label="Timeout" labelInset>
    <Input type="number" {...register("timeout")} size="sm" />
  </FormField>
</Callout>
```

### Save pattern

```ts
const mutation = useUpdateFeature();

const onSubmit = form.handleSubmit(async (data) => {
  await mutation.mutateAsync(data);
  emitToast({ kind: "success", message: "Saved." });
});
```

---

## Accessibility

| Concern | Implementation |
|---------|---------------|
| Focus ring | `2px solid var(--c-accent)`, 2px offset (global `:focus-visible`) |
| Modal a11y | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → DialogHeader |
| Focus trap | Custom hook cycles Tab within modal container |
| Scroll lock | Ref-counted `useBodyScrollLock` (supports nested overlays) |
| Icon buttons | Always provide `title` + `aria-label` |
| Switches | `role="switch"`, `aria-checked`, `aria-label` |
| Test targets | `data-testid` on interactive elements for Playwright e2e |
| Keyboard | Arrow/Enter for SearchableSelect, Tab trap in modals |

---

## Brand System

Runtime-configurable accent colors — no rebuild needed for rebranding.

**Flow:** Helm values → api-server env → `GET /api/brand` → `applyBrand()` sets CSS vars on `<html>`

**Brand schema:**
```ts
{
  name: string;       // Display name (e.g., "Dam")
  short: string;      // Short identifier (e.g., "dam")
  title: string;      // Document title (falls back to name)
  theme: {
    light: { accent, accentHover, accentLight };
    dark: { accent, accentHover, accentLight };
  };
}
```

**Usage in components:**
```ts
import { getBrand } from "@/brand";

const brandName = getBrand().name;  // Never hardcode
```

**Fallback values (if API unreachable):**
- Light: accent `#1D6BE1`, hover `#1556B8`, light `#eaf2fe`
- Dark: accent `#3C92FD`, hover `#2F88FD`, light `#0f1f3a`

---

## Do / Don't

| Do | Don't |
|----|-------|
| Use BLACK (`--primary`) for action buttons | Use blue/accent for buttons |
| Use `cn()` for all className merging | Concatenate with template literals |
| Import from `@/components/ui/button` | Use relative paths to `ui/` |
| Use named `z-*` utilities | Use raw `z-[50]` or `z-index` numbers |
| Use `emitToast()` for user feedback | Use `alert()` or inline error banners |
| Use `SectionLabel` for form section headings | Build custom uppercase spans |
| Use `anim-in` for elements appearing | Skip animation or write custom keyframes |
| Use `showConfirm()` for destructive actions | Render a one-off confirm modal |
| Use red confirm + "Delete" for destructive | Use red for reversible warnings |
| Use black confirm + amber icon for warnings | Dress warnings in red |
| Use `font-mono` for machine-generated text | Use sans for URLs, IDs, repo names |
| Design inside the full shell (rail + nav + header) | Design standalone cards on blank pages |
| Use `data-testid` for e2e test targets | Use class-based selectors in tests |
| Pass `size={16}` to icons in buttons | Use SVG width/height attributes |
| Use `gap-3` between card-list items | Use margin on individual cards |
| Keep views thin — delegate to hooks | Put query/mutation logic in views |
| Use `text-sm` (14px) as minimum body text | Use `text-xs` (12px) for readable content |
| Use `getBrand().name` for brand references | Hardcode "Dam" or "Platform" |
| Use semantic color tokens (`text-danger`) | Use raw hex values (`text-[#dc2626]`) |
| Use `Callout` for all bordered info boxes | Create ad-hoc bordered divs |
| Use `FormField` to wrap every form control | Render bare inputs without labels |
| Use `Badge` for status indicators | Build custom colored pills |
| End file imports with `.js` suffix | Omit extension or use `.ts`/`.tsx` |
| Provide empty states for every list/section | Leave blank areas when data is absent |
| Use terms from `docs/ubiquitous-language.md` | Invent terminology or use internal names |
| Prefer chat-guided flows with chips/cards | Build long multi-step wizard forms |
| Show agent work as visible steps | Show finished artifacts that teleport in |
