# Components

**Read when:** writing a component, a file nears ~200 lines, extracting subcomponents, typing props, reviewing component code.

## Size and responsibility

**[CRITICAL] A component does one thing.** One that juggles fetching, sub-form orchestration, several distinct regions and cross-cutting state is already too big; size is a proxy for responsibility.

**[HIGH] ~300 lines is a warning flag, not a cap.** Past it, look for the extraction you've been avoiding (a tab, a complex row, a form section). Split along responsibility seams and let the number follow, never mechanically. Typical sizes: page composition 50–150 lines, feature component 100–250, leaf/presentational 20–80.

**[HIGH] Count the JSX in the return separately.** 40 lines of JSX plus 200 of logic is nothing like 200 lines of nested JSX, where indentation hides structure and every conditional compounds. Targets: leaf ≤ ~25 JSX lines, feature ≤ ~60 (or sooner, once scrolling one region loses the outer structure). Past them, extract by region (header, body, row, footer) even if the file length is fine.

## Subcomponent extraction

**[CRITICAL] Extract when any holds:**

1. **Anything non-trivial inside `.map(...)`**: more than ~10 JSX lines, any conditional branch, a multi-statement handler, or any per-item derivation (`isExpanded`, `sessions = ...`). The item component owns per-item state, derivations and handlers, not the parent. This is stricter than the general size rule because list items compound: today's small card grows badges, actions and an expanded view, and then every edit touches a 200-line parent.
   ```tsx
   ❌ {connections.map((c) => (
        <div key={c.id} className="flex ...">{/* nested JSX, conditionals, handlers */}</div>
      ))}
   ✅ {connections.map((c) => <ConnectionRow key={c.id} connection={c} onDisconnect={...} />)}
   ```
2. **The return's JSX passes the weight targets** → extract by region.
3. **Markup repeats with small variations** → one `<Row variant=...>`.
4. **A block has its own state or effects** → its own component, so the state is colocated.
5. **A tab, section or panel deserves a name.** If you can't name it cleanly, it may not be a real boundary.

Layout follows `references/project-structure.md`: sibling files for < 10 sub-pieces, a nested folder for 10+ or when the group has its own hooks/types.

```
modules/{domain}/components/edit-xxx-dialog/
├── index.tsx              container, ~100-150 lines
├── credentials-tab.tsx
├── settings-tab.tsx
├── header-row.tsx
├── item-group.tsx
├── item-row.tsx
├── mode-card.tsx
└── tab-button.tsx
```

## Props

**[HIGH] Declare props as an interface (or type), destructure in the signature, no `React.FC<>`.** `FC` solved problems React no longer has (implicit `children`, generic inference quirks) and only adds clutter.

```tsx
✅ interface Props { agent: Agent; onSelect?: (id: string) => void }
   export function AgentCard({ agent, onSelect }: Props) { ... }
❌ const AgentCard: React.FC<Props> = ({ agent, onSelect }) => { ... }
```

Call it `Props` inside a component file; export it only when a parent needs the type.

**[HIGH]** A prop with a meaningful default is optional in the type and defaulted in destructuring (`{ variant = "primary" }: Props`). Avoid optional props that switch how the component works: split it (`<AgentCard>`, `<AgentCardCompact>`) or take an explicit `mode` and `match` on it.

Type pass-through children explicitly (`children: ReactNode`), not via `PropsWithChildren`.

## Handlers

**[HIGH]** `onX` for props, `handleX` internally. Inline handlers stay one statement; anything longer becomes a named function above the return.

```tsx
✅ function handleToggle(id: string) { setAssigned((prev) => toggleInSet(prev, id)); }
   return <Checkbox onChange={() => handleToggle(item.id)} />;

❌ return <Checkbox onChange={() => {
       const next = new Set(assigned);
       if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
       setAssigned(next);
     }} />
```

The toggle-in-Set shape recurs whenever users pick a subset; use `useToggleSet()` (`references/hooks.md`).

## Destructuring

**[MODERATE]** Destructure a prop, nested field or API return referenced several times in one scope; leave single uses inline (`schedule.cron`).

```tsx
❌ {schedule.status.lastRun && <span>last: {schedule.status.lastRun}</span>}
   {schedule.status.nextRun && <span>next: {schedule.status.nextRun}</span>}

✅ const { lastRun, nextRun } = schedule.status;
   {lastRun && <span>last: {lastRun}</span>}
   {nextRun && <span>next: {nextRun}</span>}
```

For optional fields, narrow first so TypeScript keeps the narrowing (`if (!schedule.status) return null;` then destructure), or pull `status` out up top and use `status.X` inside the guard, or extract `<StatusLine status={status} />`.

## Conditional rendering

**[MODERATE]** No nested ternaries; early returns read top to bottom.

```tsx
❌ {loading ? <Spinner /> : error ? <Error /> : data ? <List items={data} /> : null}
✅ if (loading) return <Spinner />;
   if (error) return <Error error={error} />;
   if (!data) return null;
   return <List items={data} />;
```

## Derived state

**[CRITICAL] Never copy derivable state into `useState`.** Compute on render; `useMemo` only if measurably expensive. A `useState` + `useEffect` copy is a second source of truth, the classic "why is this stale" bug.

```tsx
❌ const [filteredAgents, setFilteredAgents] = useState([]);
   useEffect(() => { setFilteredAgents(agents.filter((a) => a.name.includes(filter))); }, [agents, filter]);
✅ const filteredAgents = useMemo(() => agents.filter((a) => a.name.includes(filter)), [agents, filter]);
```

## Side effects

**[HIGH]** `useEffect` synchronizes with external systems (subscriptions, DOM, network where TQ doesn't fit). Not for responding to user events (do it in the handler), not for fetching (TQ, `references/async-data.md`). More than ~2 effects means the component orchestrates too much: extract a hook.

## Styling

Per `references/styling.md`: Tailwind for static styles, `cn()` for conditionals, no `style={{}}` for static values, CSS custom properties for dynamic numbers/colors.

## Fix on sight

When you touch the file:

1. Subcomponents inlined in the parent's file → sibling files or a nested folder.
2. Local `useState` duplicating server state → TQ hook.
3. Inline 30-line `.map(...)` blocks → components.
4. Static `style={{}}` (shadows, spacing, any non-runtime value) → Tailwind classes.
5. Nested loading/error/data ternaries → early returns.
