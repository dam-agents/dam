# Custom hooks

**Read when:** extracting logic from a component, writing a hook, a hook feels bloated, a component has tangled state/effects.

A hook is a named, reusable unit of stateful or effectful logic with one job you can state in one sentence; an "and" in that sentence usually means two hooks.

**[CRITICAL] Extract a hook when:**
1. The same `useState` + `useEffect` pattern appears in two or more components.
2. A component has ~5+ `useState` or 3+ `useEffect` calls (the concerns aren't local anymore).
3. A block of logic has its own lifecycle (subscribe/unsubscribe, poll, derive).
4. Setup code dominates the component and buries the JSX.

## Naming and location

**[HIGH] Always `useXxx`; file name matches in kebab case** (`use-mcp-picker.ts`, never `mcpPickerHook.ts`). Hooks are `.ts`, not `.tsx`, unless they return JSX (rare). Name what the hook **gives you**, not its process: `useSelectedAgent` over `useAgentSelection`.

- Domain hooks (depend on domain state, types or API) → `src/modules/{domain}/hooks/`.
- Shared generic hooks → `src/hooks/` (`use-debounced-callback`, `use-local-storage`, `use-toggle-set`, `use-auto-resize`, `use-media-query`).
- **Don't pre-promote**: keep a single-use hook in its module; move it to shared on the second use.

## Anatomy of a good hook

```ts
export function useMcpPicker(options: { onSelect: (server: McpServer) => void }) {
  const servers = useMcpServers();
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => servers.data?.filter((s) => s.name.includes(query)) ?? [],
    [servers.data, query],
  );
  return { query, setQuery, servers: filtered, isLoading: servers.isLoading, select: options.onSelect };
}
```

One responsibility; a small, intentional return API; derived state via `useMemo`, not `useState` + `useEffect`; server state delegated to a TQ hook (`useMcpServers`); callbacks accepted as options instead of assuming the parent's wiring.

## Return shape

**[MODERATE]** Return an object for ≥3 values; a `[value, setter]` tuple is fine for 2-value hooks mirroring `useState`.

```ts
✅ return { agents, isLoading, error, refetch };
✅ return [open, setOpen] as const;
❌ return [agents, isLoading, error, refetch];
```

## God-hooks

**[HIGH] A hook over ~200 lines, or with 5+ `useState`/`useRef` and 3+ `useEffect`, is a god-hook.** Split by lifecycle or concern. The classic case is one "session" hook owning connection lifecycle, list fetching, config caching and update routing:

```
modules/{protocol}/hooks/
├── use-xxx-connection.ts        socket open/close/reconnect, exposes send
├── use-xxx-list.ts              list query, polling if needed
├── use-xxx-config-cache.ts      fetch + persistence
├── use-xxx-streaming-updates.ts update routing / state projection
└── use-xxx-session.ts           thin orchestrator composing the above (~50 lines)
```

Each child is testable on its own.

## Shared utility hooks

When a stateful pattern repeats across files, extract instead of copying:

- `useToggleSet<T>(initial: T[])`: a `Set<T>` with `toggle`, `has`, `clear` (replaces copy-pasted `new Set(prev); n.has(id) ? n.delete(id) : n.add(id)`).
- `useLocalStorage<T>(key, initial)`: state synced to localStorage.
- `useDebouncedCallback(fn, ms)` / `useDebouncedValue(value, ms)`: debounce input or a value (search).
- `useMediaQuery(query)`, `useOnClickOutside(ref, cb)`, `useAutoResize(ref, text)`.

Never build `useAsync`, `useFetch` or `useLoadingState`: that is TanStack Query's job.

Derived values reused across components belong in a hook too:

```ts
export function useFilteredAgents(filter: string) {
  const agents = useAgents();
  return useMemo(() => agents.data?.filter((a) => matchesFilter(a, filter)) ?? [], [agents.data, filter]);
}
```

## Dependencies

**[CRITICAL] Declare exhaustive dependency arrays** (`react-hooks/exhaustive-deps` lint). When you genuinely must omit a dep, give the reason on the directive line: `// eslint-disable-next-line react-hooks/exhaustive-deps -- <why>`.

`useCallback` a handler only when it sits in a child hook's/memo's dependency array or the child is memoized; wrapping every handler is noise.

## Testing

Test pure-logic hooks (projection, derivation) with `@testing-library/react`'s `renderHook`; skip thin composition hooks.

## Anti-patterns

- Mega-hook → split.
- A hook returning a component → write a component.
- Fetching without TQ, or `useEffect` for data fetching → TQ query hook.
- Conditional hook calls (breaks the Rules of Hooks) → stable shape, branch inside.
- `useState` for derived values → `useMemo` or compute inline.
- A hook copied across files with small variations → extract or parameterize.
