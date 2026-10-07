# State management

**Read when:** deciding where state lives, writing a Zustand slice or React Context, reviewing a component's state, moving state between layers.

## The lineage model (CRITICAL)

**[CRITICAL] Never duplicate across lineages.** Server-owned data isn't copied into Zustand; Zustand state isn't shadowed in `useState`; URL state isn't mirrored into Zustand without a strong reason (e.g. a brief optimistic beat before the route resolves).

Decision recipe:
1. From the server, or persisted there? → **TanStack Query**. Stop.
2. Needed by components that aren't parent/child? → **Zustand or Context** (pick one per project).
3. Would a refresh or shared link lose something that matters? → **URL**.
4. Otherwise → **`useState`**.

## Zustand

**[HIGH]** Fits app-wide client state when the tree is deep, selector-level performance matters, or state must live outside React. React Context is the simpler default for fresh projects; use Zustand only with a concrete reason.

**[CRITICAL] Never store TQ-cacheable data in Zustand.** A legacy slice decomposes into: UI bits (selected id, filter, view mode) stay; the server list + fetch become a TQ query hook (`useAgents()`); create/update/delete become TQ mutation hooks; hand-rolled `runQuery`/`runAction`/retry wrappers are deleted. A slice left empty is deleted.

One slice per domain via `StateCreator`, holding only UI state:

```ts
export interface AgentsUiSlice {
  selectedAgentId: string | null;
  filter: string;
  setSelectedAgentId: (id: string | null) => void;
  setFilter: (q: string) => void;
}

export const createAgentsUiSlice: StateCreator<AppStore, [], [], AgentsUiSlice> = (set) => ({
  selectedAgentId: null,
  filter: "",
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  setFilter: (q) => set({ filter: q }),
});
```

**[CRITICAL] Every slice exports selector hooks**; components never call `useStore((s) => ...)` inline. Import sites stay clean and slice refactors don't touch every component.

```ts
export const useSelectedAgentId = () => useStore((s) => s.selectedAgentId);
export const useAgentFilter = () => useStore((s) => s.filter);
export const useAgentsUiActions = () =>
  useStore(useShallow((s) => ({ setSelectedAgentId: s.setSelectedAgentId, setFilter: s.setFilter })));
```

**[HIGH] Split state selectors from the actions selector.** Actions behind `useShallow` keep a stable identity, so a component that only calls `setFilter` doesn't re-render when `selectedAgentId` changes.

**[HIGH] Use `useShallow` (`zustand/react/shallow`) for any multi-field select.** The default equality is by reference, and the returned object is rebuilt each render.

```ts
export const useToast = () => useStore(useShallow((s) => ({ message: s.toast.message, kind: s.toast.kind })));
```

**[MODERATE]** Wrap the store in `devtools` in development and name actions (`set(partial, false, "agents/setFilter")`) for a readable timeline.

## React Context (default for fresh projects)

```ts
interface ThemeContextValue { theme: Theme; setTheme: (t: Theme) => void }
export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

Files: `contexts/theme/theme-context.ts`, `theme-provider.tsx`, `index.ts` (the hook).

- **[CRITICAL] The hook throws when the provider is missing**: a programmer error should crash early, not return a silent `undefined`.
- **[HIGH] Memoize an object context value**, or every render broadcasts a new reference and re-renders every consumer.
- **[MODERATE] Split state and setters into two contexts** when consumers mostly either read or write (the Context form of the Zustand split):
  ```tsx
  <ThemeStateContext.Provider value={theme}>
    <ThemeActionsContext.Provider value={actions}>{children}</ThemeActionsContext.Provider>
  </ThemeStateContext.Provider>
  ```

## Local `useState`

**[MODERATE]** ~5 `useState` calls in one component are usually related: a loading/error/data trio is a TQ query (`const { data, isLoading, error } = useAgents()`); genuinely local composite state is a `useReducer(wizardReducer, initialWizard)` or a hook.

## URL state

**[HIGH]** The URL owns what should survive a refresh or be shareable: route/subview, active tab in a persistent panel, filters, sort, pagination, search query, and the selected entity id when it determines the page. Use `useSearchParams` or the router equivalent.
