# Custom hooks

**Read when:** extracting logic from a component, writing a new hook, a hook feels bloated, reviewing a component with tangled state/effects.

## What hooks are for

Hooks are named, reusable units of stateful or effectful logic. A hook should have a single, clear job you can describe in one sentence. If the one-sentence description has an "and" in it, it's probably two hooks.

**[CRITICAL] Extract a hook when:**
1. The same `useState` + `useEffect` pattern appears in two or more components.
2. A component has **~5 or more `useState` calls** or **3+ `useEffect` calls** — the concerns aren't local anymore.
3. A block of logic has its own lifecycle (subscribe/unsubscribe, poll, derive).
4. A component's JSX is hard to read because setup code dominates the file.

## Naming

**[HIGH] Always `useXxx`, camelCase.** File name matches: `use-mcp-picker.ts`. Never `mcpPickerHook.ts` or `usePicker.tsx` (hooks are `.ts`, not `.tsx`, unless they return JSX — rare).

The name should describe what the hook **gives you**, not what it does inside. Prefer `useSelectedAgent` (returns the agent) over `useAgentSelection` (describes the process).

## Location

Two homes:

1. **Domain-specific hooks** → `src/modules/{domain}/hooks/`. Depend on domain-specific state, types, or API.
2. **Shared hooks** → `src/hooks/`. Generic, no domain knowledge. Examples: `use-debounced-callback`, `use-local-storage`, `use-toggle-set`, `use-auto-resize`, `use-media-query`.

**Don't pre-promote.** If a hook is only used in one place, keep it in the module. Move to shared on the second use.

## Anatomy of a good hook

```ts
// src/modules/mcp/hooks/use-mcp-picker.ts
export function useMcpPicker(options: { onSelect: (server: McpServer) => void }) {
  const servers = useMcpServers();         // TQ query
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => servers.data?.filter((s) => s.name.includes(query)) ?? [],
    [servers.data, query]
  );

  return {
    query,
    setQuery,
    servers: filtered,
    isLoading: servers.isLoading,
    select: options.onSelect,
  };
}
```

What makes it good:
- One responsibility (manage picker state).
- Returns a small, intentional API — not every internal value.
- Derived state computed with `useMemo`, not `useState` + `useEffect`.
- Delegates server state to a TQ hook (`useMcpServers`).
- Accepts callbacks as options, doesn't assume how the parent wires them up.

## Return shape

**[MODERATE]** Prefer returning an **object** when there are ≥3 values, with clear field names. Tuples `[value, setter]` are fine for 2-value hooks that mirror `useState` semantics.

```ts
✅ return { agents, isLoading, error, refetch };       // object
✅ return [open, setOpen] as const;                    // tuple OK for 2
❌ return [agents, isLoading, error, refetch];         // tuple for 4 — error-prone
```

## God-hook smell (and how to split)

**[HIGH] A hook over ~200 lines, or with more than 5 `useState`/`useRef` and 3+ `useEffect`, is a god-hook.** Split by **lifecycle** or by **concern**, whichever is more natural.

Classic pattern: a single "session" hook that manages connection lifecycle, list fetching, config caching, and incoming-update routing — all in one file, hundreds of lines long. Split by concern:

```
modules/{protocol}/hooks/
├── use-xxx-connection.ts        # socket open/close/reconnect, expose send
├── use-xxx-list.ts              # list query, polling if needed
├── use-xxx-config-cache.ts      # fetch + persistence
├── use-xxx-session.ts           # thin orchestrator, composes the above
└── use-xxx-streaming-updates.ts # update routing / state projection
```

The orchestrator becomes ~50 lines composing focused children. Each child is individually testable.

## Common utility hooks to reach for

When the same stateful pattern shows up in more than one file, extract a shared hook rather than copy-pasting:

- **`useToggleSet<T>(initial: T[])`** — manages a `Set<T>` with `toggle`, `has`, `clear`. Replaces the typical copy-pasted `new Set(prev); n.has(id) ? n.delete(id) : n.add(id)` pattern.
- **`useLocalStorage<T>(key: string, initial: T)`** — syncs state with localStorage.
- **`useDebouncedCallback(fn, ms)`** — debounce user input.
- **`useDebouncedValue(value, ms)`** — debounce a value (common for search inputs).
- **`useMediaQuery(query: string)`** — responsive behavior.
- **`useOnClickOutside(ref, cb)`** — for popovers, dropdowns.
- **`useAutoResize(ref, text)`** — auto-size a textarea to its content.

**Not needed once TQ is adopted:**
- `useAsync`, `useFetch`, `useLoadingState` — TanStack Query handles this. If you're tempted to build one of these, you're fighting TQ.

## Derived state belongs in hooks too

If a component computes a derived value via `useMemo` that's reused in multiple places, lift it into a hook:

```ts
// modules/agents/hooks/use-filtered-agents.ts
export function useFilteredAgents(filter: string) {
  const agents = useAgents();           // TQ query
  return useMemo(
    () => agents.data?.filter((a) => matchesFilter(a, filter)) ?? [],
    [agents.data, filter]
  );
}
```

## Dependencies

**[CRITICAL] Declare exhaustive dependency arrays** (`react-hooks/exhaustive-deps` lint, once ESLint is set up). If you think you need to omit a dep, the dependency is wrong — restructure (destructure the stable field, lift the value, extract a hook) until exhaustive-deps is satisfied without disabling the rule. Never `// eslint-disable` exhaustive-deps.

**Stable references** for callbacks passed to children: wrap in `useCallback` only when the callback is in a dependency array of a child hook/memo, or the child is memoized. Wrapping every handler is cargo-culted noise.

## Testing hooks

Out of scope for this skill's v1 (testing lives in a future reference). When it lands: test pure logic hooks (projection, derivation) with `@testing-library/react`'s `renderHook`. Skip tests for thin composition hooks.

## Anti-patterns

- **Mega-hook** (see above): split it.
- **Hook that returns a component** — if you want a component, write a component.
- **Hook that does fetching without TQ** — convert to a TQ query hook.
- **Hook that calls other hooks conditionally** — breaks the Rules of Hooks; use a stable shape and branch inside.
- **`useState` for derived values** — use `useMemo` or compute inline.
- **`useEffect` for data fetching** — use TQ.
- **Copying a hook across files with minor variations** — extract a shared hook or parameterize.
